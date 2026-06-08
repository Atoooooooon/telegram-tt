import { getDevRedis } from './dev-redis.mjs';
import { REDIS_KEYS } from './redis-keys.mjs';

const MAX_SUCCESS_CASES = 1000;

function getString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function getBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function getNumberList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function getObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value;
}

function normalizeSuccessCasePayload(payload) {
  const recordType = getString(payload.recordType);
  const chatId = getString(payload.chatId);

  const allowedRecordTypes = ['ai_draft_sent', 'ai_action_approved', 'case_resolved'];
  if (!recordType || !allowedRecordTypes.includes(recordType)) {
    throw new Error(`recordType must be one of: ${allowedRecordTypes.join(', ')}`);
  }

  if (!chatId) {
    throw new Error('chatId is required');
  }

  const createdAt = Date.now();

  return {
    id: `${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    recordType,
    caseId: getString(payload.caseId),
    chatId,
    senderId: getString(payload.senderId),
    messageIds: getNumberList(payload.messageIds),
    sourceText: getString(payload.sourceText),
    aiSummary: getString(payload.aiSummary),
    aiIntent: getString(payload.aiIntent),
    aiDraft: getString(payload.aiDraft),
    finalReply: getString(payload.finalReply),
    wasEdited: getBoolean(payload.wasEdited),
    metadata: getObject(payload.metadata),
    createdAt,
  };
}

export async function saveCustomerServiceSuccessCase(log, payload) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const record = normalizeSuccessCasePayload(payload);
  await redis.lpush(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, JSON.stringify(record));
  await redis.ltrim(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, MAX_SUCCESS_CASES - 1);

  return record;
}

export async function listCustomerServiceSuccessCases(log, limit = 50) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const values = await redis.lrange(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, safeLimit - 1);

  return values.map((value) => JSON.parse(value));
}

export async function deleteCustomerServiceSuccessCase(log, id) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const targetId = getString(id);
  if (!targetId) {
    throw new Error('id is required');
  }

  const values = await redis.lrange(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, -1);
  const remaining = [];
  let deleted = false;

  for (const value of values) {
    try {
      const record = JSON.parse(value);
      if (record?.id === targetId) {
        deleted = true;
        continue;
      }
    } catch {
      // Keep malformed historical entries instead of silently dropping data.
    }

    remaining.push(value);
  }

  if (!deleted) {
    return { deleted: false };
  }

  await redis.del(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES);
  if (remaining.length > 0) {
    await redis.rpush(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, ...remaining);
  }

  return { deleted: true };
}
