import { REDIS_CACHE_TTL_MS, REDIS_KEYS } from './redis-keys.mjs';

const DEFAULT_FIRST_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_HIGHEST_ESCALATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HOLDING_REPLY_GRACE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_REMINDER_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_HOLDING_PATTERNS = [
  '稍等',
  '我看下',
  '我看一下',
  '处理中',
  '正在处理',
  '帮你确认',
  '稍后',
  'wait',
  'checking',
  'looking into',
  'processing',
];
const DEFAULT_RESOLVE_PATTERNS = [
  '已处理',
  '已恢复',
  '好了',
  '可以了',
  '处理完成',
  '解决了',
  'resolved',
  'fixed',
  'done',
  'completed',
];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toStringList(value, fallback) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string' && value.trim()) {
    return value.split('||').map((item) => item.trim()).filter(Boolean);
  }

  return [...fallback];
}

function buildPatterns(sources) {
  return sources.map((source) => new RegExp(escapeRegExp(source), 'i'));
}

const DEFAULT_ONCALL_CONFIG = {
  firstResponseTimeoutMs: DEFAULT_FIRST_RESPONSE_TIMEOUT_MS,
  highestEscalationTimeoutMs: DEFAULT_HIGHEST_ESCALATION_TIMEOUT_MS,
  holdingReplyGraceTimeoutMs: DEFAULT_HOLDING_REPLY_GRACE_TIMEOUT_MS,
  reminderCooldownMs: DEFAULT_REMINDER_COOLDOWN_MS,
  telegramBotToken: '',
  telegramAlertChatId: '',
  telegramAlertThreadId: '',
  holdingReplyPatternSources: [...DEFAULT_HOLDING_PATTERNS],
  resolveReplyPatternSources: [...DEFAULT_RESOLVE_PATTERNS],
};

function normalizeOncallConfig(rawConfig) {
  const safeConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const holdingReplyPatternSources = toStringList(
    safeConfig.holdingReplyPatterns ?? safeConfig.holdingReplyPatternSources,
    DEFAULT_HOLDING_PATTERNS,
  );
  const resolveReplyPatternSources = toStringList(
    safeConfig.resolveReplyPatterns ?? safeConfig.resolveReplyPatternSources,
    DEFAULT_RESOLVE_PATTERNS,
  );

  return {
    firstResponseTimeoutMs: toNumber(
      safeConfig.firstResponseTimeoutMs,
      DEFAULT_FIRST_RESPONSE_TIMEOUT_MS,
    ),
    highestEscalationTimeoutMs: toNumber(
      safeConfig.highestEscalationTimeoutMs,
      DEFAULT_HIGHEST_ESCALATION_TIMEOUT_MS,
    ),
    holdingReplyGraceTimeoutMs: toNumber(
      safeConfig.holdingReplyGraceTimeoutMs,
      DEFAULT_HOLDING_REPLY_GRACE_TIMEOUT_MS,
    ),
    reminderCooldownMs: toNumber(
      safeConfig.reminderCooldownMs,
      DEFAULT_REMINDER_COOLDOWN_MS,
    ),
    telegramBotToken: typeof safeConfig.telegramBotToken === 'string' ? safeConfig.telegramBotToken.trim() : '',
    telegramAlertChatId: typeof safeConfig.telegramAlertChatId === 'string' ? safeConfig.telegramAlertChatId.trim() : '',
    telegramAlertThreadId: typeof safeConfig.telegramAlertThreadId === 'string' ? safeConfig.telegramAlertThreadId.trim() : '',
    holdingReplyPatternSources,
    resolveReplyPatternSources,
    holdingReplyPatterns: buildPatterns(holdingReplyPatternSources),
    resolveReplyPatterns: buildPatterns(resolveReplyPatternSources),
  };
}

function parseRedisConfig(rawValue) {
  if (!rawValue) {
    return undefined;
  }

  if (typeof rawValue === 'string') {
    return JSON.parse(rawValue);
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  return undefined;
}

function maskToken(token) {
  if (!token) {
    return '';
  }

  if (token.length <= 10) {
    return `${token.slice(0, 2)}***${token.slice(-2)}`;
  }

  return `${token.slice(0, 5)}***${token.slice(-4)}`;
}

export function sanitizeOncallConfigForResponse(config) {
  return {
    firstResponseTimeoutMs: config.firstResponseTimeoutMs,
    highestEscalationTimeoutMs: config.highestEscalationTimeoutMs,
    holdingReplyGraceTimeoutMs: config.holdingReplyGraceTimeoutMs,
    reminderCooldownMs: config.reminderCooldownMs,
    telegramBotTokenMasked: maskToken(config.telegramBotToken),
    telegramAlertChatId: config.telegramAlertChatId,
    telegramAlertThreadId: config.telegramAlertThreadId,
    holdingReplyPatterns: config.holdingReplyPatternSources,
    resolveReplyPatterns: config.resolveReplyPatternSources,
  };
}

export class OncallConfigProvider {
  constructor(redis, log) {
    this.redis = redis;
    this.log = log;
    this.cacheKey = REDIS_KEYS.ONCALL_CONFIG;
    this.cacheTtlMs = REDIS_CACHE_TTL_MS.ONCALL_CONFIG;
    this.cachedConfig = normalizeOncallConfig(DEFAULT_ONCALL_CONFIG);
    this.lastLoadedAt = 0;
  }

  async getConfig(options) {
    const force = Boolean(options?.force);
    const now = Date.now();

    if (!force && this.lastLoadedAt && now - this.lastLoadedAt < this.cacheTtlMs) {
      return this.cachedConfig;
    }

    if (!this.redis) {
      this.cachedConfig = normalizeOncallConfig(DEFAULT_ONCALL_CONFIG);
      this.lastLoadedAt = now;
      return this.cachedConfig;
    }

    try {
      const rawValue = await this.redis.get(this.cacheKey);
      const parsed = parseRedisConfig(rawValue);
      this.cachedConfig = normalizeOncallConfig(parsed || DEFAULT_ONCALL_CONFIG);
      this.lastLoadedAt = now;
      return this.cachedConfig;
    } catch (error) {
      this.log('Oncall Redis config load failed, using defaults', error);
      this.cachedConfig = normalizeOncallConfig(DEFAULT_ONCALL_CONFIG);
      this.lastLoadedAt = now;
      return this.cachedConfig;
    }
  }

  getConfigKey() {
    return this.cacheKey;
  }
}
