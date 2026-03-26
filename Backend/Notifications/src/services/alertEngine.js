// src/services/alertEngine.js
// Мозъкът на системата - оценява сензорни данни и решава кога да алармира
// Всяка функция получава сурови данни и връща алерт или null

const db = require('../db');
const cache = require('./cache');
const notificationService = require('./notificationService');
const logger = require('./logger');

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
    level = 2; // СРЕДНО - 75-90%
  } else if (percentage >= 0.60) {
    level = 1; // НИСКО - 60-75%
  }

  // Допълнителен фактор - интензивни валежи вдигат нивото
  if (rainfall_mm_h > 30 && level < 3) level = Math.min(level + 1, 3);

  logger.debug(`Наводнение оценка: ${riverName} ${(percentage * 100).toFixed(1)}% → ниво ${level}`);

  // Обнови риска на селото в базата данни
  await db.query(
    `UPDATE villages SET flood_risk_level = $1, risk_updated_at = NOW() WHERE id = $2`,
    [level, villageId]
  );

  // Ако няма риск, нищо не изпращаме
  if (level === 0) return null;

  // Провери cooldown - не изпращай повторен алерт от същото ниво в рамките на 30 мин
  const inCooldown = await cache.isAlertCooldown('flood', villageId, level);
  if (inCooldown) {
    logger.debug(`Cooldown активен за наводнение в село #${villageId}`);
    return null;
  }

  // Вземи данни за селото (координати за геозаявката)
  const villageResult = await db.query(
    `SELECT name, oblast, lat, lng FROM villages WHERE id = $1`,
    [villageId]
  );
  const village = villageResult.rows[0];
  if (!village) return null;

  const levelNames = { 1: 'НИСКО', 2: 'СРЕДНО', 3: 'КРИТИЧНО' };
  const levelName  = levelNames[level];

  // Радиусът нараства с нивото - КРИТИЧНО засяга по-голяма зона
  const radiusMap = { 1: 5000, 2: 10000, 3: 20000 };
  const radius    = radiusMap[level];

  // Съобщенията са конкретни - показват реални стойности
  const title = `${levelName}: Риск от наводнение — ${village.name}`;
  const body  = buildFloodMessage(level, riverName, currentLevel, criticalLevel, percentage, rainfall_mm_h);

  // Запиши алерта в базата
  const alertResult = await db.query(`
    INSERT INTO alerts 
      (type, level, level_name, village_id, origin_lat, origin_lng, radius_meters,
       sensor_data, title_bg, body_bg)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    'flood', level, levelName, villageId,
    village.lat, village.lng, radius,
    JSON.stringify({ riverName, currentLevel, criticalLevel, percentage, rainfall_mm_h }),
    title, body,
  ]);

  const alert = alertResult.rows[0];

  // Постави cooldown преди изпращане (предотвратява race condition)
  await cache.setAlertCooldown('flood', villageId, level, 30);

  // Изпрати известията
  const stats = await notificationService.notifyUsersInZone(alert, io);

  logger.info(`🌊 Наводнение алерт: ${village.name} | ${levelName} | Push: ${stats.push} SMS: ${stats.sms}`);
  return { alert, stats };
}

/**
 * Оценява данни за земетресение
 * Извиква се при ново събитие от EMSC WebSocket
 *
 * @param {Object} data - { magnitude, depth_km, lat, lng, region }
 * @param {Object} io
 */
async function assessEarthquakeRisk(data, io) {
  const { magnitude, depth_km, lat, lng, region } = data;

  const criticalMag = parseFloat(process.env.EARTHQUAKE_CRITICAL_MAGNITUDE || 5.0);
  const mediumMag   = parseFloat(process.env.EARTHQUAKE_MEDIUM_MAGNITUDE   || 3.5);

  let level = 0;

  if (magnitude >= criticalMag) {
    level = 3;
  } else if (magnitude >= mediumMag) {
    level = 2;
  } else if (magnitude >= 2.5) {
    level = 1;
  }

  // Плитки трусове (< 10 км) са по-опасни - вдигни нивото
  if (depth_km < 10 && level < 3) level = Math.min(level + 1, 3);

  if (level === 0) return null;

  // За земетресения cooldown е по-кратък - 10 мин
  // Защото вторичните трусове са реална опасност
  const inCooldown = await cache.isAlertCooldown('earthquake', `${lat}_${lng}`, level);
  if (inCooldown) return null;

  const levelNames = { 1: 'НИСКО', 2: 'СРЕДНО', 3: 'КРИТИЧНО' };
  const levelName  = levelNames[level];

  // Радиусът за земетресения е много по-голям
  const radiusMap = { 1: 30000, 2: 80000, 3: 200000 };
  const radius    = radiusMap[level];

  const title = `${levelName}: Земетресение M${magnitude.toFixed(1)} — ${region}`;
  const body  = `Регистриран трус с магнитуд ${magnitude.toFixed(1)} на дълбочина ${depth_km} км. ` +
                `${level === 3 ? 'Останете далеч от сгради и проверете за газови течове.' : 'Следете за вторични трусове.'} ` +
                `При щети или наранявания: 112.`;

  const alertResult = await db.query(`
    INSERT INTO alerts
      (type, level, level_name, origin_lat, origin_lng, radius_meters,
       sensor_data, title_bg, body_bg)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING *
  `, [
    'earthquake', level, levelName,
    lat, lng, radius,
    JSON.stringify({ magnitude, depth_km, region }),
    title, body,
  ]);

  const alert = alertResult.rows[0];
  await cache.setAlertCooldown('earthquake', `${lat}_${lng}`, level, 10);

  const stats = await notificationService.notifyUsersInZone(alert, io);

  logger.info(`🌍 Земетресение алерт: M${magnitude} ${region} | ${levelName} | Push: ${stats.push} SMS: ${stats.sms}`);
  return { alert, stats };
}

/**
 * Оценява данни за горски пожар от NASA FIRMS
 *
 * @param {Object} data - { lat, lng, nearestVillageId, distanceKm, windSpeed, daysWithoutRain }
 * @param {Object} io
 */
async function assessFireRisk(data, io) {
  const { lat, lng, nearestVillageId, distanceKm, windSpeed, daysWithoutRain } = data;

  const criticalDist = parseFloat(process.env.FIRE_CRITICAL_DISTANCE_KM || 3);
  const mediumDist   = parseFloat(process.env.FIRE_MEDIUM_DISTANCE_KM   || 10);

  let level = 0;

  if (distanceKm <= criticalDist) {
    level = 3;
  } else if (distanceKm <= mediumDist) {
    level = 2;
  } else if (distanceKm <= 25) {
    level = 1;
  }

  // Силен вятър и суша вдигат риска
  if (windSpeed > 30 && level < 3) level = Math.min(level + 1, 3);
  if (daysWithoutRain > 14 && level < 3) level = Math.min(level + 1, 3);

  if (level === 0) return null;

  const inCooldown = await cache.isAlertCooldown('fire', nearestVillageId, level);
  if (inCooldown) return null;

  const villageResult = await db.query(
    `SELECT name, oblast FROM villages WHERE id = $1`, [nearestVillageId]
  );
  const village = villageResult.rows[0];

  const levelNames = { 1: 'НИСКО', 2: 'СРЕДНО', 3: 'КРИТИЧНО' };
  const levelName  = levelNames[level];

  const radiusMap = { 1: 15000, 2: 15000, 3: 10000 };
  const radius    = radiusMap[level];

  const title = `${levelName}: Горски пожар — ${village?.name || 'Неизвестен район'}`;
  const body  = `Активен пожар на ${distanceKm.toFixed(1)} км. ` +
                `Вятър ${windSpeed} км/ч. ` +
                `${level === 3
                  ? 'Подгответе се за евакуация. Затворете прозорци и вентилация. При непосредствена опасност: 112.'
                  : 'Следете ситуацията. Не влизайте в засегнатия район.'}`;

  const alertResult = await db.query(`
    INSERT INTO alerts
      (type, level, level_name, village_id, origin_lat, origin_lng, radius_meters,
       sensor_data, title_bg, body_bg)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `, [
    'fire', level, levelName, nearestVillageId,
    lat, lng, radius,
    JSON.stringify({ distanceKm, windSpeed, daysWithoutRain }),
    title, body,
  ]);

  const alert = alertResult.rows[0];
  await cache.setAlertCooldown('fire', nearestVillageId, level, 20);

  await db.query(
    `UPDATE villages SET fire_risk_level = $1, risk_updated_at = NOW() WHERE id = $2`,
    [level, nearestVillageId]
  );

  const stats = await notificationService.notifyUsersInZone(alert, io);

  logger.info(`🔥 Пожар алерт: ${village?.name} | ${distanceKm}км | ${levelName} | Push: ${stats.push} SMS: ${stats.sms}`);
  return { alert, stats };
}

// --- Helper функции ---

function buildFloodMessage(level, riverName, current, critical, pct, rainfall) {
  const pctStr = (pct * 100).toFixed(0);
  const base   = `Ниво на р. ${riverName}: ${current.toFixed(2)}м (${pctStr}% от критичния праг ${critical}м).`;
  const rain   = rainfall > 20 ? ` Валежи: ${rainfall} мм/ч.` : '';

  const actions = {
    3: ' Преместете се незабавно на по-високо място. Не минавайте през наводнени пътища. Обадете се на 112.',
    2: ' Избягвайте речните корита и ниско лежащи зони. Следете нивото на реката.',
    1: ' Ситуацията се наблюдава. Без непосредствена опасност.',
  };

  return base + rain + actions[level];
}

module.exports = { assessFloodRisk, assessEarthquakeRisk, assessFireRisk };
