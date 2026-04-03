import { getDevRedis } from './dev-redis.mjs';

const CONFIG_HASH_KEY = 'telegram_web:config';

function normalizeId(value) {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function ownersMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber === rightNumber;
}

async function readRecord(redis, token) {
  const rawValue = await redis.hget(CONFIG_HASH_KEY, token);
  if (!rawValue) {
    return undefined;
  }

  return JSON.parse(rawValue);
}

export async function fetchCustomerServiceCloudRecord(log, token, currentUserId) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Cloud sync Redis is not configured');
  }

  const record = await readRecord(redis, token);
  if (!record) {
    return undefined;
  }

  const ownerId = normalizeId(record.ownerId);
  const requester = normalizeId(currentUserId);

  return {
    ...record,
    ownerId,
    canUpdate: ownersMatch(ownerId, requester),
  };
}

export async function saveCustomerServiceCloudRecord(log, token, payload) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Cloud sync Redis is not configured');
  }

  const ownerId = normalizeId(payload.ownerId);
  if (!ownerId) {
    throw new Error('Owner id is required to upload settings');
  }

  const existing = await readRecord(redis, token);
  if (existing?.ownerId && !ownersMatch(existing.ownerId, ownerId)) {
    throw new Error('You are not allowed to overwrite this configuration');
  }

  const version = existing?.version ? existing.version + 1 : 1;
  const updatedAt = Date.now();
  const record = {
    settings: payload.settings,
    ownerId,
    version,
    updatedAt,
  };

  await redis.hset(CONFIG_HASH_KEY, token, JSON.stringify(record));

  return {
    version,
    updatedAt,
    ownerId,
  };
}
