import { Redis } from '@upstash/redis/cloudflare';

import { CUSTOMER_SERVICE_CONFIG } from '../config/customerService';

const KEY_PREFIX = 'customer-service-config';

type CloudSyncRecord = {
  settings: unknown;
  ownerId?: string;
  version: number;
  updatedAt: number;
};

export type CloudConfigResponse = CloudSyncRecord & {
  canUpdate?: boolean;
};

type UploadRequestPayload = {
  ownerId: string;
  settings: unknown;
};

type UploadResponse = {
  version: number;
  updatedAt: number;
  ownerId: string;
};

let redisClient: Redis | undefined;

function getRedis(): Redis {
  if (redisClient) {
    return redisClient;
  }

  const { CLOUD_SYNC_REDIS_URL, CLOUD_SYNC_REDIS_TOKEN } = CUSTOMER_SERVICE_CONFIG;
  if (!CLOUD_SYNC_REDIS_URL || !CLOUD_SYNC_REDIS_TOKEN) {
    throw new Error('Cloud sync Redis credentials are not configured');
  }

  redisClient = new Redis({
    url: CLOUD_SYNC_REDIS_URL,
    token: CLOUD_SYNC_REDIS_TOKEN,
  });

  return redisClient;
}

function buildKey(token: string) {
  return `${KEY_PREFIX}:${token}`;
}

function normalizeId(value?: string | null) {
  if (!value) {
    return undefined;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function ownersMatch(left?: string, right?: string) {
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

export async function fetchCustomerServiceCloudConfig(
  token: string,
  currentUserId?: string,
): Promise<CloudConfigResponse | undefined> {
  const redis = getRedis();
  const key = buildKey(token);

  const record = await redis.get<CloudSyncRecord>(key);
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

export async function uploadCustomerServiceCloudConfig(
  token: string,
  payload: UploadRequestPayload,
): Promise<UploadResponse> {
  const redis = getRedis();
  const key = buildKey(token);

  const ownerId = normalizeId(payload.ownerId);
  if (!ownerId) {
    throw new Error('Owner id is required to upload settings');
  }

  const existing = await redis.get<CloudSyncRecord>(key);
  if (existing?.ownerId && !ownersMatch(existing.ownerId, ownerId)) {
    throw new Error('You are not allowed to overwrite this configuration');
  }

  const version = existing?.version ? existing.version + 1 : 1;
  const updatedAt = Date.now();

  const record: CloudSyncRecord = {
    settings: payload.settings,
    ownerId,
    version,
    updatedAt,
  };

  await redis.set(key, record);

  return {
    version,
    updatedAt,
    ownerId,
  };
}
