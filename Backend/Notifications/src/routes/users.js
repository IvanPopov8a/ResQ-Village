// src/routes/users.js
// Endpoints за регистрация на потребители, обновяване на локация,
// и управление на push subscriptions

const express = require('express');
const router  = express.Router();
const db = require('../db/setup');
const logger  = require('../services/logger');

/**
 * POST /api/users/register
 * Регистрира нов потребител или обновява съществуващ
 * Извиква се при първо зареждане на PWA
 */
router.post('/register', async (req, res) => {
  const { phone, email, villageId, notifyFlood, notifyEarthquake, notifyFire, minLevel, smsFallback } = req.body;

  try {
    // Upsert - ако потребителят вече съществува (по телефон), обнови данните
    const result = await db.query(`
      INSERT INTO users (phone, email, village_id, notify_flood, notify_earthquake, notify_fire, min_level, sms_fallback)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (phone) DO UPDATE SET
        email             = EXCLUDED.email,
        village_id        = EXCLUDED.village_id,
        notify_flood      = EXCLUDED.notify_flood,
        notify_earthquake = EXCLUDED.notify_earthquake,
        notify_fire       = EXCLUDED.notify_fire,
        min_level         = EXCLUDED.min_level,
        sms_fallback      = EXCLUDED.sms_fallback,
        last_seen         = NOW()
      RETURNING id, phone, village_id
    `, [
      phone || null,
      email || null,
      villageId || null,
      notifyFlood !== false,
      notifyEarthquake !== false,
      notifyFire !== false,
      minLevel || 2,
      smsFallback || false,
    ]);

    const user = result.rows[0];
    logger.info(`Потребител регистриран/обновен: #${user.id}`);

    res.json({
      success: true,
      userId: user.id,
      message: 'Регистрацията е успешна',
    });

  } catch (err) {
    logger.error(`Грешка при регистрация: ${err.message}`);
    res.status(500).json({ success: false, error: 'Грешка при регистрация' });
  }
});

/**
 * PUT /api/users/:id/location
 * Обновява локацията на потребителя
 * Извиква се периодично от PWA (на всеки 5 минути или при промяна)
 * КРИТИЧНА функция - на база локацията се определя кои алерти получава
 */
router.put('/:id/location', async (req, res) => {
  const { id } = req.params;
  const { lat, lng } = req.body;

  if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'Невалидни координати' });
  }

  // Валидация - координатите трябва да са в разумни граници за България
  if (lat < 41 || lat > 44.5 || lng < 22 || lng > 29)  {
    return res.status(400).json({ error: 'Координатите са извън обхвата' });
  }

  try {
    await db.query(`
      UPDATE users SET
        last_lat      = $2,
        last_lng      = $3,
        -- PostGIS geography точка за пространствени заявки
        last_location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
        last_seen     = NOW()
      WHERE id = $1
    `, [id, lat, lng]);

    // Върни активните алерти в зоната на потребителя
    // Полезно при отваряне на приложението - веднага виждаш дали има опасност
    const activeAlerts = await db.query(`
      SELECT id, type, level, level_name, title_bg, body_bg, created_at,
             ST_Distance(
               ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
               ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography
             ) / 1000 AS distance_km
      FROM alerts
      WHERE active = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
          ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326)::geography,
          radius_meters
        )
      ORDER BY level DESC, created_at DESC
      LIMIT 10
    `, [id, lat, lng]);

    res.json({
      success: true,
      activeAlerts: activeAlerts.rows,
    });

  } catch (err) {
    logger.error(`Грешка при обновяване на локация: ${err.message}`);
    res.status(500).json({ error: 'Грешка при обновяване' });
  }
});

/**
 * POST /api/users/:id/push-subscription
 * Записва push subscription от браузъра
 * Извиква се веднъж след като потребителят разреши известия
 */
router.post('/:id/push-subscription', async (req, res) => {
  const { id } = req.params;
  const { subscription } = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Невалидна push subscription' });
  }

  try {
    await db.query(`
      UPDATE users SET push_subscription = $2 WHERE id = $1
    `, [id, JSON.stringify(subscription)]);

    logger.info(`Push subscription записана за потребител #${id}`);
    res.json({ success: true, message: 'Push известията са активирани' });

  } catch (err) {
    logger.error(`Грешка при записване на subscription: ${err.message}`);
    res.status(500).json({ error: 'Грешка при активиране на известия' });
  }
});

/**
 * DELETE /api/users/:id/push-subscription
 * Деактивира push известията
 */
router.delete('/:id/push-subscription', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE users SET push_subscription = NULL WHERE id = $1`, [id]
    );
    res.json({ success: true, message: 'Push известията са деактивирани' });
  } catch (err) {
    res.status(500).json({ error: 'Грешка' });
  }
});

/**
 * GET /api/users/:id/alerts
 * Връща активните алерти за потребителя (базирано на последна локация)
 */
router.get('/:id/alerts', async (req, res) => {
  const { id } = req.params;

  try {
    const userResult = await db.query(
      `SELECT last_lat, last_lng FROM users WHERE id = $1`, [id]
    );

    if (!userResult.rows[0]?.last_lat) {
      return res.json({ alerts: [], message: 'Локацията не е известна' });
    }

    const { last_lat: lat, last_lng: lng } = userResult.rows[0];

    const alertsResult = await db.query(`
      SELECT 
        a.id, a.type, a.level, a.level_name,
        a.title_bg, a.body_bg,
        a.origin_lat, a.origin_lng,
        a.created_at,
        ROUND(ST_Distance(
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          ST_SetSRID(ST_MakePoint(a.origin_lng, a.origin_lat), 4326)::geography
        ) / 1000, 1) AS distance_km
      FROM alerts a
      WHERE a.active = true
        AND ST_DWithin(
          ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
          ST_SetSRID(ST_MakePoint(a.origin_lng, a.origin_lat), 4326)::geography,
          a.radius_meters
        )
      ORDER BY a.level DESC, a.created_at DESC
    `, [lat, lng]);

    res.json({ alerts: alertsResult.rows });

  } catch (err) {
    logger.error(`Грешка при вземане на алерти: ${err.message}`);
    res.status(500).json({ error: 'Грешка' });
  }
});

module.exports = router;
