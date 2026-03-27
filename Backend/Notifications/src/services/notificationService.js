// src/services/notificationService.js
// Централната логика за изпращане на известия
// Обработва Push (WebPush) и SMS (Twilio) паралелно

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const webpush = require('web-push');
const twilio = require('twilio');
const db = require('../db/setup');
const logger = require('./logger');

// Конфигурация на Web Push с VAPID ключове
console.log("VAPID Email:", process.env.VAPID_EMAIL);
console.log("VAPID Public Key:", process.env.VAPID_PUBLIC_KEY ? "Loaded ✅" : "Missing ❌");

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Twilio клиент
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Нива на заплаха
const LEVELS = {
  1: { name: 'НИСКО',    emoji: '🟡', color: '#BA7517' },
  2: { name: 'СРЕДНО',   emoji: '🟠', color: '#D85A30' },
  3: { name: 'КРИТИЧНО', emoji: '🔴', color: '#E24B4A' },
};

// Типове бедствия
const DISASTER_TYPES = {
  flood:       { name: 'Наводнение', emoji: '💧' },
  earthquake:  { name: 'Земетресение', emoji: '🌍' },
  fire:        { name: 'Горски пожар', emoji: '🔥' },
  landslide:   { name: 'Свлачище', emoji: '⛰️' },
};

/**
 * Главна функция - изпраща известия до всички потребители
 * в засегнатата зона според тяхната локация и настройки
 *
 * @param {Object} alert - Данни за алерта от базата данни
 * @param {Object} io - Socket.io инстанция за real-time обновяване
 */
async function notifyUsersInZone(alert, io) {
  const { type, level, level_name, origin_lat, origin_lng, radius_meters,
          title_bg, body_bg, id: alertId } = alert;

  logger.info(`Известяване за алерт #${alertId}: ${type} ${level_name} | радиус ${radius_meters}м`);

  // Намери всички потребители в засегнатата зона
  // PostGIS ST_DWithin прави географска заявка по разстояние
  const usersResult = await db.query(`
    SELECT 
      u.id,
      u.phone,
      u.push_subscription,
      u.sms_fallback,
      u.notify_${type} AS notify_this_type,
      u.min_level,
      -- Изчисли разстоянието в метри за логване
      ST_Distance(
        u.last_location,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
      ) AS distance_meters
    FROM users u
    WHERE 
      -- Потребителят е в засегнатата зона
      u.last_location IS NOT NULL
      AND ST_DWithin(
        u.last_location,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3  -- радиус в метри
      )
      -- Иска да получава известия за този тип бедствие
      AND u.notify_${type} = true
      -- Нивото е над минималния му праг
      AND $4 >= u.min_level
  `, [origin_lat, origin_lng, radius_meters, level]);

  const users = usersResult.rows;
  logger.info(`Намерени ${users.length} потребители в зоната`);

  if (users.length === 0) return { push: 0, sms: 0 };

  // Изпрати известията паралелно за всички потребители
  // Promise.allSettled не спира при грешка при един потребител
  const results = await Promise.allSettled(
    users.map(user => notifyUser(user, alert, alertId))
  );

  // Обобщи резултатите
  let pushSent = 0, smsSent = 0;
  results.forEach(result => {
    if (result.status === 'fulfilled') {
      if (result.value.push) pushSent++;
      if (result.value.sms) smsSent++;
    }
  });

  // Обнови броячите в базата
  await db.query(
    `UPDATE alerts SET notified_push = $1, notified_sms = $2 WHERE id = $3`,
    [pushSent, smsSent, alertId]
  );

  // Изпрати real-time update до всички свързани клиенти чрез Socket.io
  // Картата на платформата се обновява веднага
  if (io) {
    io.emit('alert:new', {
      id: alertId,
      type,
      level,
      levelName: level_name,
      title: title_bg,
      body: body_bg,
      lat: origin_lat,
      lng: origin_lng,
      radiusMeters: radius_meters,
      notifiedCount: pushSent + smsSent,
      timestamp: new Date().toISOString(),
    });
  }

  logger.info(`✅ Алерт #${alertId}: ${pushSent} push + ${smsSent} SMS изпратени`);
  return { push: pushSent, sms: smsSent };
}

/**
 * Изпраща известие до един конкретен потребител
 * Опитва Push първо, после SMS ако е настроен
 */
async function notifyUser(user, alert, alertId) {
  const result = { push: false, sms: false };

  // --- WEB PUSH ---
  if (user.push_subscription) {
    result.push = await sendPushNotification(user, alert, alertId);
  }

  // --- SMS ---
  // Изпрати SMS ако:
  // 1. Потребителят е настроил SMS резервен канал
  // 2. Push е неуспешен или потребителят няма push subscription
  // 3. Алертът е КРИТИЧЕН (винаги изпрати SMS при критично)
  const shouldSendSms = user.phone && (
    user.sms_fallback ||
    (!result.push && user.phone) ||
    alert.level === 3
  );

  if (shouldSendSms) {
    result.sms = await sendSmsNotification(user, alert, alertId);
  }

  return result;
}

/**
 * Изпраща Web Push известие
 * Криптирано съобщение до push сървъра на браузъра
 */
async function sendPushNotification(user, alert, alertId) {
  const { type, level, title_bg, body_bg, origin_lat, origin_lng } = alert;
  const levelInfo = LEVELS[level];
  const disasterInfo = DISASTER_TYPES[type] || { name: type, emoji: '⚠️' };

  const payload = JSON.stringify({
    title: `${levelInfo.emoji} ${title_bg}`,
    body: body_bg,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: `resq-alert-${type}`,      // замества предишното известие от същия тип
    requireInteraction: level === 3, // КРИТИЧНО не изчезва автоматично
    vibrate: level === 3 ? [200, 100, 200, 100, 200] : [200],
    data: {
      alertId,
      type,
      level,
      lat: origin_lat,
      lng: origin_lng,
      url: `/alerts/${alertId}`,    // отваря се при клик
    },
    actions: [
      { action: 'view',    title: 'Виж детайли' },
      { action: 'call112', title: 'Обади се на 112' },
    ],
  });

  try {
    await webpush.sendNotification(user.push_subscription, payload);

    await logNotification(alertId, user.id, 'push', 'sent');
    return true;

  } catch (err) {
    // 410 Gone = потребителят е деинсталирал приложението
    // Изтрий subscription от базата
    if (err.statusCode === 410) {
      await db.query(
        `UPDATE users SET push_subscription = NULL WHERE id = $1`,
        [user.id]
      );
      logger.debug(`Push subscription изтрита за потребител #${user.id} (410 Gone)`);
    } else {
      logger.error(`Push грешка за потребител #${user.id}: ${err.message}`);
    }

    await logNotification(alertId, user.id, 'push', 'failed', err.message);
    return false;
  }
}

/**
 * Изпраща SMS чрез Twilio
 * Кратко, ясно съобщение на прост български
 */
async function sendSmsNotification(user, alert, alertId) {
  const { type, level, title_bg, origin_lat, origin_lng } = alert;
  const levelInfo = LEVELS[level];
  const disasterInfo = DISASTER_TYPES[type] || { name: type, emoji: '⚠️' };

  // SMS е кратък - максимум 160 символа за 1 SMS
  // Ясен, прост език достъпен за всеки
  const smsText = buildSmsText(type, level, levelInfo, disasterInfo, alertId);

  try {
    await twilioClient.messages.create({
      body: smsText,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: user.phone,
    });

    await logNotification(alertId, user.id, 'sms', 'sent');
    logger.debug(`SMS изпратен до ${user.phone.substring(0, 6)}***`);
    return true;

  } catch (err) {
    logger.error(`SMS грешка за потребител #${user.id}: ${err.message}`);
    await logNotification(alertId, user.id, 'sms', 'failed', err.message);
    return false;
  }
}

/**
 * Изгражда SMS текст според типа и нивото
 * Максимум 160 символа, прост език
 */
function buildSmsText(type, level, levelInfo, disasterInfo, alertId) {
  const messages = {
    flood: {
      3: `⚠️ КРИТИЧНО: Риск от наводнение. Отидете на по-високо място СЕГА. Не минавайте през вода. Обадете се на 112. resq.bg/a/${alertId}`,
      2: `⚠️ ВНИМАНИЕ: Повишен риск от наводнение в района. Следете нивото на реките. Пригответе се. resq.bg/a/${alertId}`,
      1: `ℹ️ Следим повишени нива на реките в района. Без непосредствена опасност. resq.bg/a/${alertId}`,
    },
    earthquake: {
      3: `⚠️ ЗЕМЕТРЕСЕНИЕ: Засечен силен трус. Останете далеч от сгради. Проверете за газови течове. Обадете се на 112.`,
      2: `⚠️ Земетресение M${''} в района. Проверете сградата за щети. Бъдете готови за вторични трусове.`,
      1: `ℹ️ Регистриран слаб трус в района. Без сериозна опасност. Следете официални съобщения.`,
    },
    fire: {
      3: `⚠️ КРИТИЧНО: Горски пожар наближава района. Подгответе се за евакуация. Затворете прозорци. 112 при опасност.`,
      2: `⚠️ ВНИМАНИЕ: Горски пожар в района. Не влизайте в засегнатата зона. Следете за промени.`,
      1: `ℹ️ Засечен горски пожар на по-голямо разстояние. Следим ситуацията. resq.bg/a/${alertId}`,
    },
  };

  return messages[type]?.[level] ||
    `${levelInfo.emoji} ${levelInfo.name}: ${disasterInfo.name} в района. Следете resq.bg/a/${alertId}`;
}

/**
 * Записва всяко изпратено известие в лога
 */
async function logNotification(alertId, userId, channel, status, error = null) {
  await db.query(
    `INSERT INTO notification_log (alert_id, user_id, channel, status, error)
     VALUES ($1, $2, $3, $4, $5)`,
    [alertId, userId, channel, status, error]
  ).catch(err => logger.error(`Лог грешка: ${err.message}`));
}

module.exports = {
  notifyUsersInZone,
  sendPushNotification,
  sendSmsNotification,
  LEVELS,
  DISASTER_TYPES,
};
