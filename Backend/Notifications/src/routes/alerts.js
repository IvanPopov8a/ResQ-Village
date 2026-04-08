// src/routes/alerts.js
// Endpoints за алерти - четене, ръчно създаване (за администратори),
// и feedback от потребители

const express = require('express');
const router  = express.Router();
const db = require('../db/setup');
const alertEngine = require('../services/alertEngine');
const logger  = require('../services/logger');
const DOMPurify = require('isomorphic-dompurify');

/**
 * GET /api/alerts
 * Всички активни алерти за картата
 * Извиква се при зареждане на картата и периодично за обновяване
 */
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        a.id, a.type, a.level, a.level_name,
        a.title_bg, a.body_bg,
        a.origin_lat, a.origin_lng,
        a.radius_meters,
        a.notified_push, a.notified_sms,
        a.created_at,
        v.name AS village_name,
        v.oblast
      FROM alerts a
      LEFT JOIN villages v ON a.village_id = v.id
      WHERE a.active = true
      ORDER BY a.level DESC, a.created_at DESC
      LIMIT 50
    `);

    res.json({ alerts: result.rows });

  } catch (err) {
    logger.error(`Грешка при вземане на алерти: ${err.message}`);
    res.status(500).json({ error: 'Грешка' });
  }
});

/**
 * GET /api/alerts/:id
 * Детайли за конкретен алерт (отваря се при клик на известие)
 */
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(`
      SELECT 
        a.*,
        v.name AS village_name,
        v.oblast,
        v.mayor_phone
      FROM alerts a
      LEFT JOIN villages v ON a.village_id = v.id
      WHERE a.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Алертът не е намерен' });
    }

    res.json({ alert: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: 'Грешка' });
  }
});

/**
 * POST /api/alerts/manual
 * Ръчно създаване на алерт от администратор (кмет, ПБЗН)
 * Изисква Bearer токен в Authorization хедъра (стойността идва от ADMIN_SECRET в .env)
 */

// Middleware за проверка на admin токен
const crypto = require('crypto');

function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(process.env.ADMIN_SECRET || ''))) {
    return res.status(401).json({ error: 'Неоторизиран достъп' });
  }
  next();
}

router.post('/manual', requireAdminAuth, async (req, res) => {
  const { type, level, villageId, titleBg, bodyBg, radiusMeters } = req.body;

  if (!type || !level || !titleBg || !bodyBg) {
    return res.status(400).json({ error: 'Липсват задължителни полета' });
  }

  try {
    const villageResult = await db.query(
      `SELECT lat, lng, name FROM villages WHERE id = $1`, [villageId]
    );

    if (!villageResult.rows[0]) {
      return res.status(404).json({ error: 'Селото не е намерено' });
    }

    const village = villageResult.rows[0];
    const levelNames = { 1: 'НИСКО', 2: 'СРЕДНО', 3: 'КРИТИЧНО' };

    // Sanitize user input to prevent XSS
    const sanitizedTitle = DOMPurify.sanitize(titleBg);
    const sanitizedBody = DOMPurify.sanitize(bodyBg);

    const alertResult = await db.query(`
      INSERT INTO alerts
        (type, level, level_name, village_id, origin_lat, origin_lng,
         radius_meters, title_bg, body_bg, sensor_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      type, level, levelNames[level], villageId,
      village.lat, village.lng,
      radiusMeters || 10000,
      sanitizedTitle, sanitizedBody,
      JSON.stringify({ source: 'manual', createdBy: 'admin' }),
    ]);

    const alert = alertResult.rows[0];

    // Вземи Socket.io от app locals и изпрати известията
    const io = req.app.get('io');
    const stats = await require('../services/notificationService').notifyUsersInZone(alert, io);

    logger.info(`Ръчен алерт създаден: #${alert.id} | ${type} ниво ${level}`);

    res.json({
      success: true,
      alertId: alert.id,
      notified: stats,
    });

  } catch (err) {
    logger.error(`Грешка при ръчен алерт: ${err.message}`);
    res.status(500).json({ error: 'Грешка при създаване на алерт' });
  }
});

/**
 * POST /api/alerts/:id/feedback
 * Потребителят дава обратна връзка дали алертът е бил точен
 * Данните се използват за калибриране на праговете
 */
router.post('/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { accurate, comment } = req.body; // accurate: true/false

  try {
    // В продукция запазваш в отделна таблица за анализ
    logger.info(`Feedback за алерт #${id}: ${accurate ? '✅ точен' : '❌ неточен'} | ${comment || ''}`);

    res.json({ success: true, message: 'Благодарим за обратната връзка' });
  } catch (err) {
    res.status(500).json({ error: 'Грешка' });
  }
});

/**
 * PUT /api/alerts/:id/resolve
 * Маркира алерт като разрешен (за администратори)
 */
router.put('/:id/resolve', async (req, res) => {
  const { id } = req.params;

  try {
    await db.query(
      `UPDATE alerts SET active = false, resolved_at = NOW() WHERE id = $1`, [id]
    );

    const io = req.app.get('io');
    if (io) io.emit('alert:resolved', { id: parseInt(id) });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Грешка' });
  }
});

module.exports = router;