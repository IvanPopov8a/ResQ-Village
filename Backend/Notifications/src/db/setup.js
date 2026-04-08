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

    // 1. Почистваме старите данни, за да нямаме дубликати
    await client.query(`TRUNCATE TABLE villages CASCADE;`);

    console.log('Старите тестови данни са изтрити. Добавяне на 50-те нови села...');

    // 2. Вкарваме реалния списък с всички нужни колони
    await client.query(`
      INSERT INTO villages (name, oblast, lat, lng, fire_risk_level, mayor_phone)
      VALUES 
        ('Bregovo', 'Vidin', 44.1500, 22.6600, 0, '0888000001'),
        ('Dondukovo', 'Vidin', 44.0000, 22.5500, 0, '0888000002'),
        ('Drenovets', 'Vidin', 43.7700, 22.9300, 0, '0888000003'),
        ('Valchedram', 'Montana', 43.7000, 23.4500, 0, '0888000004'),
        ('Belimel', 'Montana', 43.5200, 23.0800, 0, '0888000005'),
        ('Byala Slatina', 'Vratsa', 43.4700, 23.9300, 0, '0888000006'),
        ('Borovan', 'Vratsa', 43.4300, 23.7300, 0, '0888000007'),
        ('Knezha (village)', 'Pleven', 43.5000, 24.0800, 0, '0888000008'),
        ('Glozhene', 'Lovech', 43.0800, 23.9500, 0, '0888000009'),
        ('Ugarchin', 'Lovech', 43.1000, 24.4200, 0, '0888000010'),
        ('Dolni Dabnik', 'Pleven', 43.4000, 24.4300, 0, '0888000011'),
        ('Byala Cherkva', 'Veliko Tarnovo', 43.2100, 25.1000, 0, '0888000012'),
        ('Polikraishte', 'Veliko Tarnovo', 43.1200, 25.5600, 0, '0888000013'),
        ('Dve Mogili', 'Ruse', 43.6000, 25.8700, 0, '0888000014'),
        ('Samuil', 'Razgrad', 43.5300, 26.7700, 0, '0888000015'),
        ('Opaka', 'Targovishte', 43.4500, 26.1800, 0, '0888000016'),
        ('Popovo', 'Targovishte', 43.3500, 26.2300, 0, '0888000017'),
        ('Sitovo', 'Silistra', 43.9700, 27.1800, 0, '0888000018'),
        ('Dulovo', 'Silistra', 43.8200, 27.1500, 0, '0888000019'),
        ('General Toshevo', 'Dobrich', 43.7000, 28.0400, 0, '0888000020'),
        ('Krushari', 'Dobrich', 43.8700, 27.7500, 0, '0888000021'),
        ('Avren', 'Varna', 43.1500, 27.7500, 0, '0888000022'),
        ('Dalgopol', 'Varna', 43.0000, 27.3500, 0, '0888000023'),
        ('Nikola Kozlevo', 'Shumen', 43.4800, 27.2500, 0, '0888000024'),
        ('Nevestino', 'Kyustendil', 42.2000, 22.8300, 0, '0888000025'),
        ('Treklyano', 'Kyustendil', 42.5600, 22.6200, 0, '0888000026'),
        ('Zemen', 'Pernik', 42.5000, 22.9200, 0, '0888000027'),
        ('Svoge', 'Sofia Province', 43.0600, 23.3400, 0, '0888000028'),
        ('Koprivshtitsa (village)', 'Sofia Province', 42.6400, 24.3600, 0, '0888000029'),
        ('Mirkovo', 'Sofia Province', 42.6900, 23.9700, 0, '0888000030'),
        ('Kresna', 'Blagoevgrad', 41.8200, 23.1600, 0, '0888000031'),
        ('Belitsa', 'Blagoevgrad', 41.9500, 23.5700, 0, '0888000032'),
        ('Garmen', 'Blagoevgrad', 41.6200, 23.8200, 0, '0888000033'),
        ('Bratsigovo', 'Pazardzhik', 42.0200, 24.3700, 0, '0888000034'),
        ('Strelcha', 'Pazardzhik', 42.5100, 24.3200, 0, '0888000035'),
        ('Kaloyanovo', 'Plovdiv', 42.3700, 24.7200, 0, '0888000036'),
        ('Sadovo', 'Plovdiv', 42.1300, 24.9400, 0, '0888000037'),
        ('Bratya Daskalovi', 'Stara Zagora', 42.2700, 25.2200, 0, '0888000038'),
        ('Nikolaevo', 'Stara Zagora', 42.6300, 25.7800, 0, '0888000039'),
        ('Kotel (village)', 'Sliven', 42.8800, 26.4500, 0, '0888000040'),
        ('Tundzha (village)', 'Yambol', 42.3800, 26.5200, 0, '0888000041'),
        ('Sredets', 'Burgas', 42.3500, 27.1700, 0, '0888000042'),
        ('Kameno', 'Burgas', 42.5700, 27.3000, 0, '0888000043'),
        ('Malko Tarnovo', 'Burgas', 41.9900, 27.5200, 0, '0888000044'),
        ('Banite', 'Smolyan', 41.6800, 24.9400, 0, '0888000045'),
        ('Borino', 'Smolyan', 41.6800, 24.2700, 0, '0888000046'),
        ('Ardino', 'Kardzhali', 41.5900, 25.1300, 0, '0888000047'),
        ('Momchilgrad', 'Kardzhali', 41.5300, 25.4100, 0, '0888000048'),
        ('Madzharovo', 'Haskovo', 41.6000, 25.8500, 0, '0888000049'),
        ('Harmanli', 'Haskovo', 41.9300, 25.9000, 0, '0888000050');
    `);
    await client.query(`
  ALTER TABLE villages ADD COLUMN IF NOT EXISTS fire_probability FLOAT DEFAULT 0.0;
  ALTER TABLE villages ADD COLUMN IF NOT EXISTS flood_probability FLOAT DEFAULT 0.0;
  ALTER TABLE villages ADD COLUMN IF NOT EXISTS earthquake_probability FLOAT DEFAULT 0.0;
`);

    console.log('Новите бази данни са успешно заредени!');
  } catch (err) {
    console.error('Грешка при инициализация на базата:', err);
  } finally {
    client.release();
    //pool.end();
  }
}

setup();

module.exports = pool;
