// src/routes/alerts.js
// Endpoints за алерти - четене, ръчно създаване (за администратори),
// и feedback от потребители

const express = require('express');
const router  = express.Router();
const db = require('../db/setup');
const alertEngine = require('../services/alertEngine');
const logger  = require('../services/logger');

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
    res.status(500).json({ error: 'Грешка при зареждане на алертите' });
  }
});

/**
 * POST /api/alerts/manual
 * Сега приема aiTitle и aiMessage от Python (Gemini)
 */
router.post('/manual', async (req, res) => {
  const { type, level, villageId, lat, lng, aiTitle, aiMessage } = req.body;

  if (!type || !level || !villageId) {
    return res.status(400).json({ error: 'Липсват задължителни полета' });
  }

  try {
    // Подаваме AI данните към Alert Engine
    const { alert, stats } = await alertEngine.createManualAlert(
      type, level, villageId, lat, lng, aiTitle, aiMessage
    );

    logger.info(`[INFO] Ръчен алерт създаден: #${alert.id} | ${type} ниво ${level}`);

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
 */
router.post('/:id/feedback', async (req, res) => {
  const { id } = req.params;
  const { accurate, comment } = req.body; 

  try {
    logger.info(`Feedback за алерт #${id}: ${accurate ? '✅ точен' : '❌ неточен'} | ${comment || ''}`);
    res.json({ success: true, message: 'Благодарим за обратната връзка' });
  } catch (err) {
    res.status(500).json({ error: 'Грешка' });
  }
});

/**
 * PUT /api/alerts/:id/resolve
 * Маркира алерт като разрешен (неактивен)
 */
router.put('/:id/resolve', async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`UPDATE alerts SET active = false, resolved_at = NOW() WHERE id = $1`, [id]);
    logger.info(`Алерт #${id} е маркиран като разрешен.`);
    res.json({ success: true, message: 'Алертът е деактивиран' });
  } catch (err) {
    logger.error(`Грешка при деактивиране на алерт: ${err.message}`);
    res.status(500).json({ error: 'Грешка' });
  }
});

module.exports = router;