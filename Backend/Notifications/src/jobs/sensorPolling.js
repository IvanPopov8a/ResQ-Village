// src/jobs/sensorPolling.js
// Планирани задачи за polling на външни API-та
// Изпълняват се автоматично на фиксирани интервали

const cron        = require('node-cron');
const axios       = require('axios');
const db          = require('../db/setup');
const cache       = require('../services/cache');
const alertEngine = require('../services/alertEngine');
const logger      = require('../services/logger');

let io = null;

function startAllJobs(socketIo) {
  io = socketIo;
  logger.info('Стартиране на cron jobs...');

  //cron.schedule('*/5 * * * *', () => pollHydrologicalData());
  //cron.schedule('*/2 * * * *', () => pollSeismicData());

  cron.schedule('*/15 * * * *', () => pollFireData());
  cron.schedule('0 3 * * *', () => cleanOldAlerts());

  logger.info('Cron jobs активни: пожари(15м)');
}

async function pollHydrologicalData() {
  logger.debug('Polling: хидроложки данни...');
  try {
    const villagesResult = await db.query('SELECT id, name, lat, lng FROM villages ORDER BY id');
    for (const village of villagesResult.rows) {
      const sensorData = simulateHydrologicalSensor(village);
      await cache.set(`sensor:hydro:${village.id}`, { ...sensorData, villageId: village.id, timestamp: new Date().toISOString() }, 600);
      if (sensorData.currentLevel > 0) {
        await alertEngine.assessFloodRisk({ villageId: village.id, ...sensorData }, io);
      }
    }
  } catch (err) {
    logger.error('Грешка при polling на хидроложки данни: ' + err.message);
  }
}

async function pollSeismicData() {
  logger.debug('Polling: сеизмични данни...');
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const response = await axios.get(process.env.EMSC_API_URL, {
      params: { format: 'json', starttime: tenMinutesAgo, minmag: 2.0, minlat: 41.0, maxlat: 44.5, minlon: 22.0, maxlon: 29.0, orderby: 'time' },
      timeout: 10000,
    });
    const events = response.data?.features || [];
    for (const event of events) {
      const props  = event.properties;
      const coords = event.geometry.coordinates;
      const eventKey = 'seismic:processed:' + props.unid;
      const already  = await cache.get(eventKey);
      if (already) continue;
      await cache.set(eventKey, true, 86400);
      await alertEngine.assessEarthquakeRisk({ magnitude: props.mag, depth_km: coords[2], lat: coords[1], lng: coords[0], region: props.flynn_region || 'България' }, io);
    }
  } catch (err) {
    if (err.code === 'ECONNABORTED') {
      logger.warn('EMSC API timeout');
    } else {
      logger.error('Грешка при polling на сеизмични данни: ' + err.message);
    }
  }
}

async function pollFireData() {
  logger.debug('Polling: пожарни данни...');
  try {
    const firePoints = simulateFireData();
    for (const fire of firePoints) {
      const nearestResult = await db.query(`
        SELECT id, name,
          ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS distance_km
        FROM villages
        ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        LIMIT 1
      `, [fire.lat, fire.lng]);

      if (nearestResult.rows.length === 0) continue;
      const nearest = nearestResult.rows[0];

      await alertEngine.assessFireRisk({
        lat:              fire.lat,
        lng:              fire.lng,
        nearestVillageId: nearest.id,
        distanceKm:       nearest.distance_km,
        windSpeed:        fire.windSpeed,
        daysWithoutRain:  fire.daysWithoutRain,
      }, io);
    }
  } catch (err) {
    logger.error('Грешка при polling на пожарни данни: ' + err.message);
  }
}

async function cleanOldAlerts() {
  const result = await db.query(`
    UPDATE alerts SET active = false, resolved_at = NOW()
    WHERE active = true AND created_at < NOW() - INTERVAL '48 hours'
  `);
  logger.info('Почистени ' + result.rowCount + ' стари алерти');
}

function simulateHydrologicalSensor(village) {
  const baseLevel     = 0.8 + Math.random() * 0.5;
  const criticalLevel = 2.70;
  const isTestScenario = Math.random() < 0.05;
  return {
    riverName:     'р. при ' + village.name,
    currentLevel:  isTestScenario ? criticalLevel * 0.92 : baseLevel,
    criticalLevel,
    rainfall_mm_h: Math.random() * 15,
  };
}

function simulateFireData() {
  if (Math.random() < 0.10) {
    return [{
      lat:             41.6 + Math.random() * 0.5,
      lng:             24.5 + Math.random() * 1.0,
      windSpeed:       15 + Math.random() * 20,
      daysWithoutRain: Math.floor(Math.random() * 20),
    }];
  }
  return [];
}

module.exports = { startAllJobs };