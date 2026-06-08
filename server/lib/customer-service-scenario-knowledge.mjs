import { readFile } from 'node:fs/promises';

import { getDevRedis } from './dev-redis.mjs';
import { REDIS_KEYS } from './redis-keys.mjs';

const DEFAULT_KNOWLEDGE_URL = new URL('../../docs/customer-service-oncall-scenarios.md', import.meta.url);
const MAX_SCENARIO_KNOWLEDGE_BYTES = 240_000;

function getString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

async function readFallbackKnowledge(redisError) {
  try {
    const content = await readFile(DEFAULT_KNOWLEDGE_URL, 'utf8');
    const normalizedContent = getString(content);

    if (!normalizedContent) {
      return {
        record: undefined,
        source: 'empty',
        unavailable: true,
        error: redisError || 'Default scenario knowledge is empty',
      };
    }

    return {
      record: {
        format: 'markdown',
        content: normalizedContent,
      },
      source: 'fallback',
      unavailable: Boolean(redisError),
      error: redisError,
    };
  } catch (error) {
    return {
      record: undefined,
      source: 'empty',
      unavailable: true,
      error: redisError || getErrorMessage(error),
    };
  }
}

async function seedFallbackKnowledge(redis, log) {
  const fallback = await readFallbackKnowledge();
  const content = fallback.record?.content;

  if (!content) {
    return fallback;
  }

  try {
    const updatedAt = Date.now();
    await redis.set(REDIS_KEYS.CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE, content);

    return {
      record: {
        ...fallback.record,
        updatedAt,
      },
      source: 'redis-seeded',
      unavailable: false,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    if (typeof log === 'function') {
      log('Customer service scenario knowledge seed failed', {
        error: message,
        key: REDIS_KEYS.CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE,
      });
    }

    return {
      ...fallback,
      unavailable: true,
      error: message,
    };
  }
}

export async function fetchCustomerServiceScenarioKnowledge(log) {
  let redis;

  try {
    redis = await getDevRedis(log);
  } catch (error) {
    return readFallbackKnowledge(getErrorMessage(error));
  }

  if (!redis) {
    return readFallbackKnowledge('Redis is not configured');
  }

  try {
    const rawValue = await redis.get(REDIS_KEYS.CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE);
    const content = getString(rawValue);

    if (content) {
      return {
        record: {
          format: 'markdown',
          content,
        },
        source: 'redis',
        unavailable: false,
      };
    }

    return seedFallbackKnowledge(redis, log);
  } catch (error) {
    return readFallbackKnowledge(getErrorMessage(error));
  }
}

export async function saveCustomerServiceScenarioKnowledge(log, payload) {
  const content = typeof payload?.content === 'string' ? payload.content : '';

  if (!content.trim()) {
    throw new Error('content is required');
  }

  if (Buffer.byteLength(content, 'utf8') > MAX_SCENARIO_KNOWLEDGE_BYTES) {
    throw new Error(`content is too large; limit is ${MAX_SCENARIO_KNOWLEDGE_BYTES} bytes`);
  }

  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const updatedAt = Date.now();
  await redis.set(REDIS_KEYS.CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE, content);

  return {
    updatedAt,
  };
}
