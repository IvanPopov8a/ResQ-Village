// src/db/setup.js
// Изпълни веднъж: node src/db/setup.js

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setup() {
  const client = await pool.connect();

  try {
    console.log('Създаване на схема...');

    // PostGIS разширение за географски заявки
    await client.query(`CREATE EXTENSION IF NOT EXISTS postgis;`);

    // Таблица с всички села и техните рискови зони
    await client.query(`
      CREATE TABLE IF NOT EXISTS villages (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(255) NOT NULL,
        oblast       VARCHAR(255) NOT NULL,
        lat          DECIMAL(10, 7) NOT NULL,
        lng          DECIMAL(10, 7) NOT NULL,
        -- Географска точка за пространствени заявки
        location     GEOGRAPHY(POINT, 4326) GENERATED ALWAYS AS (
                       ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
                     ) STORED,
        -- Рискови нива по тип бедствие (1=ниско, 2=средно, 3=критично)
        flood_risk_level    INTEGER DEFAULT 0,
        earthquake_risk_level INTEGER DEFAULT 0,
        fire_risk_level     INTEGER DEFAULT 0,
        -- Последно обновяване на риска
        risk_updated_at TIMESTAMP,
        -- Контакт на кметство
        mayor_phone  VARCHAR(20),
        created_at   TIMESTAMP DEFAULT NOW()
      );
    `);

    // Индекс за бързи географски заявки
    await client.query(`
      CREATE INDEX IF NOT EXISTS villages_location_idx 
      ON villages USING GIST(location);
    `);

    // Регистрирани потребители с локация и push subscription
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                SERIAL PRIMARY KEY,
        phone             VARCHAR(20),           -- за SMS
        email             VARCHAR(255),
        -- Последно известна локация
        last_lat          DECIMAL(10, 7),
        last_lng          DECIMAL(10, 7),
        last_location     GEOGRAPHY(POINT, 4326),
        -- Push subscription обект от браузъра (JSON)
        push_subscription JSONB,
        -- Кое село е регистриран (може да е различно от локацията)
        village_id        INTEGER REFERENCES villages(id),
        -- Настройки за известия
        notify_flood      BOOLEAN DEFAULT true,
        notify_earthquake BOOLEAN DEFAULT true,
        notify_fire       BOOLEAN DEFAULT true,
        min_level         INTEGER DEFAULT 2,     -- 1=ниско, 2=средно, 3=критично
        -- Офлайн SMS резервен канал
        sms_fallback      BOOLEAN DEFAULT false,
        last_seen         TIMESTAMP DEFAULT NOW(),
        created_at        TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS users_location_idx 
      ON users USING GIST(last_location);
    `);

    // История на всички алерти
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id            SERIAL PRIMARY KEY,
        type          VARCHAR(50) NOT NULL,  -- flood, earthquake, fire
        level         INTEGER NOT NULL,      -- 1, 2, 3
        level_name    VARCHAR(20) NOT NULL,  -- НИСКО, СРЕДНО, КРИТИЧНО
        village_id    INTEGER REFERENCES villages(id),
        -- Епицентър / произход
        origin_lat    DECIMAL(10, 7),
        origin_lng    DECIMAL(10, 7),
        -- Засегнат радиус в метри
        radius_meters INTEGER,
        -- Данните, довели до алерта
        sensor_data   JSONB,
        -- Съобщение
        title_bg      TEXT NOT NULL,
        body_bg       TEXT NOT NULL,
        -- Брой уведомени
        notified_push INTEGER DEFAULT 0,
        notified_sms  INTEGER DEFAULT 0,
        -- Статус
        active        BOOLEAN DEFAULT true,
        resolved_at   TIMESTAMP,
        created_at    TIMESTAMP DEFAULT NOW()
      );
    `);

    // Лог на всяко изпратено известие
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id         SERIAL PRIMARY KEY,
        alert_id   INTEGER REFERENCES alerts(id),
        user_id    INTEGER REFERENCES users(id),
        channel    VARCHAR(20) NOT NULL,  -- push, sms
        status     VARCHAR(20) NOT NULL,  -- sent, failed, delivered
        error      TEXT,
        sent_at    TIMESTAMP DEFAULT NOW()
      );
    `);

    // Примерни данни за тестване
    await client.query(`
      INSERT INTO villages (name, oblast, lat, lng, mayor_phone, flood_risk_level)
      VALUES 
        ('Искрец',        'Софийска',  42.9123, 23.1456, '0910123456', 0),
        ('Петрохан',      'Монтана',   43.1234, 23.2345, '0920234567', 0),
        ('Карлово',       'Пловдивска', 42.6432, 24.8123, '0930345678', 0),
        ('Ябланица',      'Ловешка',   43.0234, 24.0876, '0940456789', 0),
        ('Горна Оряховица','Великотърновска', 43.1245, 25.6789, '0950567890', 0)
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ База данни настроена успешно!');
    console.log('✅ PostGIS активиран');
    console.log('✅ Таблици създадени: villages, users, alerts, notification_log');
    console.log('✅ Примерни данни добавени');

  } catch (err) {
    console.error('❌ Грешка при настройка:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

setup();
