// src/services/alertEngine.js
// Мозъкът на системата - оценява сензорни данни и решава кога да алармира
// Всяка функция получава сурови данни и връща алерт или null

const db = require('../db/setup');
const cache = require('./cache');
const notificationService = require('./notificationService');
const logger = require('./logger');

const LEVEL_NAMES = {
  1: 'НИСКО',
  2: 'СРЕДНО',
  3: 'КРИТИЧНО'
};

/**
 * Оценява данни за наводнение
 * Извиква се при всяко polling на NIMH API
 *
 * @param {Object} data - { villageId, riverName, currentLevel, criticalLevel, rainfall_mm_h }
 * @param {Object} io   - Socket.io за real-time обновяване на картата
 */
async function assessFloodRisk(data, io) {
  const { villageId, riverName, currentLevel, criticalLevel, rainfall_mm_h } = data;

  // Изчисли процент от критичното ниво
  const percentage = currentLevel / criticalLevel;

  // Определи ниво на риска
  let level = 0;
  const criticalMultiplier = parseFloat(process.env.FLOOD_CRITICAL_MULTIPLIER || 0.90);
  const mediumMultiplier   = parseFloat(process.env.FLOOD_MEDIUM_MULTIPLIER   || 0.75);

  if (percentage >= criticalMultiplier) {
    level = 3; // КРИТИЧНО - 90%+ от критичното ниво
  } else if (percentage >= mediumMultiplier) {
    level = 2; // СРЕДНО - 75%+ от критичното ниво
  } else if (percentage >= 0.50) {
    level = 1; // НИСКО - само за информация на таблото, обикновено без push
  }

  if (level === 0) return null; // Всичко е наред

  const levelName = LEVEL_NAMES[level];

  // Провери в кеша дали вече сме пращали алерт за това ниво скоро
  if (await cache.isAlertCooldown('flood', villageId, levelName)) {
    return null; // Вече сме алармирали, не спамим
  }

  // Вземи локацията на селото
  const villageResult = await db.query('SELECT name, lat, lng FROM villages WHERE id = $1', [villageId]);
  const village = villageResult.rows[0];

  if (!village) return null;

  // Създай съобщението
  const messageText = buildFloodMessage(level, riverName, currentLevel, criticalLevel, percentage, rainfall_mm_h);
  
  // Създай записа в базата
  const alertResult = await db.query(`
    INSERT INTO alerts 
      (type, level, level_name, village_id, origin_lat, origin_lng, radius_meters, sensor_data, title_bg, body_bg)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    'flood', level, levelName, villageId, 
    village.lat, village.lng, 5000, // 5km радиус за наводнения
    JSON.stringify(data),
    `Опасност от наводнение: ${village.name}`, 
    messageText
  ]);

  const alert = alertResult.rows[0];

  // Маркирай в кеша, че сме пратили алерт (Cooldown: 12 часа за наводнения)
  await cache.setAlertCooldown('flood', villageId, levelName, 12 * 60 * 60);

  // Обнови статуса на селото за картата
  await db.query(
    `UPDATE villages SET flood_risk_level = $1, risk_updated_at = NOW() WHERE id = $2`,
    [level, villageId]
  );

  // Изпрати нотификациите (WebPush + SMS)
  const stats = await notificationService.notifyUsersInZone(alert, io);
  
  logger.info(`🌊 Наводнение алерт: ${village.name} | ${levelName} | Push: ${stats.push} SMS: ${stats.sms}`);
  
  return { alert, stats };
}

/**
 * Създава ръчен алерт, извикан от Python ML модела
 * Приема динамични AI съобщения
 */
async function createManualAlert(type, level, nearestVillageId, lat, lng, aiTitle = null, aiMessage = null) {
  const levelName = LEVEL_NAMES[level] || 'НЕИЗВЕСТНО';
  
  // Вземаме селото за логовете
  const villageResult = await db.query('SELECT name FROM villages WHERE id = $1', [nearestVillageId]);
  const village = villageResult.rows[0];

  // Ако Python изпрати Gemini съобщение, използваме него. Иначе ползваме hardcoded.
  const hardcodedFallback = notificationService.getDefaultMessage(type, level, null);
  const title = aiTitle || hardcodedFallback.title;
  const body = aiMessage || hardcodedFallback.body;

  const radius = level === 3 ? 10000 : 5000; // 10km за критично, 5km за средно

  const alertResult = await db.query(`
    INSERT INTO alerts 
      (type, level, level_name, village_id, origin_lat, origin_lng, radius_meters, sensor_data, title_bg, body_bg)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    type, level, levelName, nearestVillageId,
    lat, lng, radius,
    JSON.stringify({ source: 'python_ml_model' }),
    title, body,
  ]);

  const alert = alertResult.rows[0];
  await cache.setAlertCooldown(type, nearestVillageId, level, 20);

  // Обновяваме риска на селото
  await db.query(
    `UPDATE villages SET ${type}_risk_level = $1, risk_updated_at = NOW() WHERE id = $2`,
    [level, nearestVillageId]
  );

  // Пращаме известията
  const stats = await notificationService.notifyUsersInZone(alert, global.io);

  logger.info(`🔥 ${type.toUpperCase()} алерт: ${village?.name} | ${levelName} | Push: ${stats.push} SMS: ${stats.sms}`);
  return { alert, stats };
}

// --- Helper функции ---

function buildFloodMessage(level, riverName, current, critical, pct, rainfall) {
  const pctStr = (pct * 100).toFixed(0);
  const base   = `Ниво на р. ${riverName}: ${current.toFixed(2)}м (${pctStr}% от критичния праг ${critical}м).`;
  const rain   = rainfall > 20 ? ` Очакват се още ${rainfall}мм валежи.` : '';
  
  if (level === 3) return `КРИТИЧНО! ${base}${rain} Подгответе се за евакуация!`;
  if (level === 2) return `ВНИМАНИЕ! ${base}${rain} Следете инструкциите.`;
  return `ИНФО: ${base}`;
}

module.exports = {
  assessFloodRisk,
  createManualAlert
};