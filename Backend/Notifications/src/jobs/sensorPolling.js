// src/jobs/sensorPolling.js
// Планирани задачи за polling на външни API-та
// Изпълняват се автоматично на фиксирани интервали

const cron = require('node-cron');
const axios = require('axios');
const db = require('../db/setup');
const cache = require('../services/cache');
const alertEngine = require('../services/alertEngine');
const logger = require('../services/logger');

let io = null; // Socket.io инстанция, инжектирана при стартиране

/**
 * Стартира всички cron jobs
 * Извиква се веднъж при стартиране на сървъра
 */
function startAllJobs(socketIo) {
  io = socketIo;
  logger.info('Стартиране на cron jobs...');

  // Метеорологични и хидроложки данни - на всеки 5 минути
  //cron.schedule('*/5 * * * *', () => pollHydrologicalData());

  // Сеизмични данни - на всеки 2 минути (земетресенията са непредвидими)
  //cron.schedule('*/2 * * * *', () => pollSeismicData());

  // NASA FIRMS пожари - на всеки 15 минути (сателитите преминават на 10-20 мин)
  cron.schedule('*/15 * * * * ', () => pollFireData());

  // Почисти стари алерти - веднъж дневно в 3 сутринта
  cron.schedule('0 3 * * *', () => cleanOldAlerts());

  logger.info('✅ Cron jobs активни: хидроложки(5м) | сеизмичен(2м) | пожари(10м)');

  // Изпълни веднага при стартиране за бърза инициализация
  //pollHydrologicalData();
  //pollSeismicData();
}

/**
 * Polling на NIMH API за нива на реките и валежи
 * В реална среда: https://www.nimh.bg/api/rivers
 */
async function pollHydrologicalData() {
  logger.debug('Polling: хидроложки данни...');

  try {
    // Вземи всички села с реки за мониторинг от базата
    const villagesResult = await db.query(`
      SELECT id, name, lat, lng FROM villages ORDER BY id
    `);

    for (const village of villagesResult.rows) {
      // В реална среда тук правиш HTTP заявка към NIMH API
      // const response = await axios.get(`${process.env.NIMH_API_URL}/river-levels`, {
      //   params: { lat: village.lat, lng: village.lng, radius: 20 },
      //   headers: { 'X-API-Key': process.env.NIMH_API_KEY },
      // });
      // const sensorData = response.data;

      // За демонстрация симулираме данни от сензори
      const sensorData = simulateHydrologicalSensor(village);

      // Кешираме последните данни в Redis (за показване в dashboard)
      await cache.set(
        `sensor:hydro:${village.id}`,
        { ...sensorData, villageId: village.id, timestamp: new Date().toISOString() },
        600 // 10 минути TTL
      );

      // Пусни данните през alert engine за оценка
      if (sensorData.currentLevel > 0) {
        await alertEngine.assessFloodRisk({ villageId: village.id, ...sensorData }, io);
      }
    }

  } catch (err) {
    logger.error(`Грешка при polling на хидроложки данни: ${err.message}`);
  }
}

/**
 * Polling на EMSC за земетресения
 * https://www.seismicportal.eu/fdsnws/event/1/query
 */
async function pollSeismicData() {
  logger.debug('Polling: сеизмични данни...');

  try {
    // Вземи земетресения от последните 10 минути в България и региона
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const response = await axios.get(process.env.EMSC_API_URL, {
      params: {
        format:   'json',
        starttime: tenMinutesAgo,
        minmag:    2.0,   // само над магнитуд 2.0
        minlat:    41.0,  // ограничение до България и региона
        maxlat:    44.5,
        minlon:    22.0,
        maxlon:    29.0,
        orderby:  'time',
      },
      timeout: 10000,
    });

    const events = response.data?.features || [];
    logger.debug(`EMSC: ${events.length} сеизмични събития`);

    for (const event of events) {
      const props  = event.properties;
      const coords = event.geometry.coordinates;

      // Провери дали вече сме обработили това събитие
      const eventKey = `seismic:processed:${props.unid}`;
      const already  = await cache.get(eventKey);
      if (already) continue;

      // Маркирай като обработено (TTL 24 часа)
      await cache.set(eventKey, true, 86400);

      await alertEngine.assessEarthquakeRisk({
        magnitude: props.mag,
        depth_km:  coords[2],
        lat:       coords[1],
        lng:       coords[0],
        region:    props.flynn_region || 'България',
      }, io);
    }

  } catch (err) {
    // EMSC API може да е временно недостъпен - логваме но не прекъсваме
    if (err.code === 'ECONNABORTED') {
      logger.warn('EMSC API timeout - ще опитаме при следващото polling');
    } else {
      logger.error(`Грешка при polling на сеизмични данни: ${err.message}`);
    }
  }
}

/**
 * Polling на NASA FIRMS за активни пожари
 * https://firms.modaps.eosdis.nasa.gov/api/
 */
async function pollFireData() {
    try {
        const url = process.env.FIRE_API_URL;
        const response = await axios.get(url);

        // 1. Convert CSV to JSON
        const jsonArray = await csv().fromString(response.data);

        if (jsonArray.length === 0) {
            console.log("🔥 No active fires detected.");
            return;
        }

        // 2. Loop through each fire (Use FOR...OF, not .forEach!)
        for (const fire of jsonArray) {
            const { latitude, longitude, bright_ti4 } = fire;

            // This is where line 187 was causing the crash
            const nearestResult = await db.query(
                `SELECT name FROM villages 
                 ORDER BY location <-> ST_SetSRID(ST_Point($1, $2), 4326) 
                 LIMIT 1`, 
                [longitude, latitude]
            );

            if (nearestResult.rows.length > 0) {
                const villageName = nearestResult.rows[0].name;
                console.log(`🔥 Fire near ${villageName} (Lat: ${latitude}, Lon: ${longitude})`);
                
                // Trigger your alert logic here if needed
            }
        }

    } catch (error) {
    console.error("❌ Error during fire polling:", error.message);
    if (error.response) {
        console.error("Data from NASA:", error.response.data);
    }
}
  }

  try {
    // NASA FIRMS API за MODIS и VIIRS сателити
    // const response = await axios.get('https://firms.modaps.eosdis.nasa.gov/api/area/csv', {
    //   params: {
    //     api_key: process.env.NASA_FIRMS_KEY,
    //     source:  'VIIRS_SNPP_NRT',
    //     area:    '22,41,29,44',  // longitude min/max, latitude min/max за България
    //     day_range: 1,
    //   }
    // });
    // Парсирай CSV и обработи всяка горяща точка...

    // За демонстрация - симулираме данни
    const firePoints = simulateFireData();

    for (const fire of firePoints) {
      // За всяка горяща точка намери най-близкото село чрез PostGIS
      const nearestResult = await db.query(`
        SELECT 
          id, name,
          ST_Distance(
            location,
            ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
          ) / 1000 AS distance_km
        FROM villages
        ORDER BY location <-> ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
        LIMIT 1
      `, [fire.lat, fire.lng]);

      if (nearestResult.rows.length === 0) continue;

      const nearest = nearestResult.rows[0];

      await alertEngine.assessFireRisk({
        lat:             fire.lat,
        lng:             fire.lng,
        nearestVillageId: nearest.id,
        distanceKm:      nearest.distance_km,
        windSpeed:        fire.windSpeed,
        daysWithoutRain:  fire.daysWithoutRain,
      }, io);
    }

  } catch (err) {
    logger.error(`Грешка при polling на пожарни данни: ${err.message}`);
  }
}

/**
 * Почиства неактивни алерти по-стари от 48 часа
 */
async function cleanOldAlerts() {
  const result = await db.query(`
    UPDATE alerts 
    SET active = false, resolved_at = NOW()
    WHERE active = true 
    AND created_at < NOW() - INTERVAL '48 hours'
  `);
  logger.info(`Почистени ${result.rowCount} стари алерти`);
}

// --- Симулатори за демонстрация ---
// В продукция заменяш с реални API заявки

function simulateHydrologicalSensor(village) {
  // Симулира реалистични стойности с малко случайност
  const baseLevel = 0.8 + Math.random() * 0.5;
  const criticalLevel = 2.70;

  // Понякога симулирай опасно ниво за тестване
  const isTestScenario = Math.random() < 0.05; // 5% шанс

  return {
    riverName:     `р. при ${village.name}`,
    currentLevel:  isTestScenario ? criticalLevel * 0.92 : baseLevel,
    criticalLevel,
    rainfall_mm_h: Math.random() * 15,
  };
}

function simulateFireData() {
  // Симулира потенциална горяща точка в Родопите
  if (Math.random() < 0.10) { // 10% шанс при всяко polling
    return [{
      lat:            41.6 + Math.random() * 0.5,
      lng:            24.5 + Math.random() * 1.0,
      windSpeed:      15 + Math.random() * 20,
      daysWithoutRain: Math.floor(Math.random() * 20),
    }];
  }
  return [];
}

module.exports = { startAllJobs };
