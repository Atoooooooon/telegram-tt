import Redis from 'ioredis';

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return false;
}

let redisClient;

export async function getDevRedis(log) {
  if (redisClient) {
    return redisClient;
  }

  const host = process.env.DEV_REDIS_HOST;
  if (!host) {
    return undefined;
  }

  const client = new Redis({
    host,
    port: toNumber(process.env.DEV_REDIS_PORT, 6379),
    db: toNumber(process.env.DEV_REDIS_DB, 0),
    username: process.env.DEV_REDIS_USER || undefined,
    password: process.env.DEV_REDIS_PASS || undefined,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    ...(toBoolean(process.env.DEV_REDIS_TLS) ? { tls: {} } : {}),
  });

  client.on('error', (error) => {
    log('DEV Redis client error', error);
  });

  await client.connect();
  redisClient = client;
  log('DEV Redis connected', {
    host,
    port: toNumber(process.env.DEV_REDIS_PORT, 6379),
    db: toNumber(process.env.DEV_REDIS_DB, 0),
  });

  return redisClient;
}
