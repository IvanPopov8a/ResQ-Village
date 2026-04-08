// src/services/cache.js
// Redis за кеширане на сензорни данни и дедупликация на алерти

const { createClient } = require('redis');
const logger = require('./logger');

let client = null;

async function getClient() {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not configured')
  }

  if (client && client.isReady) return client;

  client = createClient({ url: process.env.REDIS_URL });
  
  client.on('error', (err) => logger.error(`Redis грешка: ${err.message}`));
  client.on('connect', () => logger.info('Redis свързан'));

  await client.connect();
  return client;
}

// Запази данни с TTL (секунди)
async function set(key, value, ttlSeconds = 300) {
  const redis = await getClient();
  await redis.setEx(key, ttlSeconds, JSON.stringify(value));
}

// Вземи данни
async function get(key) {
  const redis = await getClient();
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}

// Изтрий
async function del(key) {
  const redis = await getClient();
  await redis.del(key);
}

// Провери дали алерт за тази зона е изпращан наскоро
// Предотвратява спам при повтарящи се тригери
async function isAlertCooldown(type, villageId, levelName) {
  const key = `alert_cooldown:${type}:${villageId}:${levelName}`;
  const redis = await getClient();
  const exists = await redis.get(key);
  return !!exists;
}

// Постави cooldown - не изпращай същия алерт за N минути
async function setAlertCooldown(type, villageId, levelName, minutes = 30) {
  const key = `alert_cooldown:${type}:${villageId}:${levelName}`;
  const redis = await getClient();
  await redis.setEx(key, minutes * 60, '1');
}

module.exports = { set, get, del, isAlertCooldown, setAlertCooldown };
