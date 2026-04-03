const DEFAULT_FIRST_RESPONSE_TIMEOUT_MS = 10 * 1000;
const DEFAULT_HIGHEST_ESCALATION_TIMEOUT_MS = 20 * 1000;
const DEFAULT_HOLDING_REPLY_GRACE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_REMINDER_COOLDOWN_MS = 60 * 1000;
const DEFAULT_STAFF_IDS = [];
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
const DEFAULT_CUSTOMER_RESOLVE_PATTERNS = [
  '^好的$',
  '^好$',
  '^知道了$',
  '^明白了$',
  '^收到$',
  '^OK$',
  '^ok$',
  '^okay$',
  '^谢谢$',
  '^感谢$',
];

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toStringList(value, fallback) {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => String(item).trim()).filter(Boolean);
    return normalized.length ? normalized : [...fallback];
  }

  if (typeof value === 'string' && value.trim()) {
    return value.split('||').map((item) => item.trim()).filter(Boolean);
  }

  return [...fallback];
}

function parseRegexSource(source) {
  const trimmed = String(source || '').trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('/')) {
    const lastSlashIndex = trimmed.lastIndexOf('/');
    if (lastSlashIndex > 0) {
      const pattern = trimmed.slice(1, lastSlashIndex);
      const flags = trimmed.slice(lastSlashIndex + 1) || 'i';
      return new RegExp(pattern, flags);
    }
  }

  return new RegExp(trimmed, 'i');
}

function buildPatterns(sources) {
  return sources.reduce((result, source) => {
    try {
      const pattern = parseRegexSource(source);
      if (pattern) {
        result.push(pattern);
      }
    } catch (error) {
      // Ignore invalid regex entries to keep the guarantee flow available.
    }

    return result;
  }, []);
}

export function getDefaultOncallConfig() {
  return {
    enabled: false,
    firstResponseTimeoutMs: DEFAULT_FIRST_RESPONSE_TIMEOUT_MS,
    highestEscalationTimeoutMs: DEFAULT_HIGHEST_ESCALATION_TIMEOUT_MS,
    holdingReplyGraceTimeoutMs: DEFAULT_HOLDING_REPLY_GRACE_TIMEOUT_MS,
    reminderCooldownMs: DEFAULT_REMINDER_COOLDOWN_MS,
    staffIds: toStringList(
      process.env.ONCALL_STAFF_IDS,
      DEFAULT_STAFF_IDS,
    ),
    telegramBotToken: typeof process.env.ONCALL_TELEGRAM_BOT_TOKEN === 'string'
      ? process.env.ONCALL_TELEGRAM_BOT_TOKEN.trim()
      : '',
    newAlertChatId: '',
    newAlertThreadId: '',
    holdingAlertChatId: '',
    holdingAlertThreadId: '',
    highestAlertChatId: '',
    highestAlertThreadId: '',
    processingAlertChatId: '',
    processingAlertThreadId: '',
    resolvedAlertChatId: '',
    resolvedAlertThreadId: '',
    holdingReplyPatternSources: [...DEFAULT_HOLDING_PATTERNS],
    resolveReplyPatternSources: [...DEFAULT_RESOLVE_PATTERNS],
    customerResolvePatternSources: toStringList(
      process.env.ONCALL_CUSTOMER_RESOLVE_PATTERNS,
      DEFAULT_CUSTOMER_RESOLVE_PATTERNS,
    ),
  };
}

export function normalizeOncallConfig(rawConfig, baseConfig = getDefaultOncallConfig()) {
  const safeConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const holdingReplyPatternSources = toStringList(
    safeConfig.holdingReplyPatterns ?? safeConfig.holdingReplyPatternSources,
    baseConfig.holdingReplyPatternSources,
  );
  const resolveReplyPatternSources = toStringList(
    safeConfig.resolveReplyPatterns ?? safeConfig.resolveReplyPatternSources,
    baseConfig.resolveReplyPatternSources,
  );
  const customerResolvePatternSources = toStringList(
    safeConfig.customerResolvePatterns ?? safeConfig.customerResolvePatternSources,
    baseConfig.customerResolvePatternSources,
  );

  return {
    enabled: Boolean(safeConfig.enabled),
    firstResponseTimeoutMs: toNumber(
      safeConfig.firstResponseTimeoutMs,
      baseConfig.firstResponseTimeoutMs,
    ),
    highestEscalationTimeoutMs: toNumber(
      safeConfig.highestEscalationTimeoutMs,
      baseConfig.highestEscalationTimeoutMs,
    ),
    holdingReplyGraceTimeoutMs: toNumber(
      safeConfig.holdingReplyGraceTimeoutMs,
      baseConfig.holdingReplyGraceTimeoutMs,
    ),
    reminderCooldownMs: toNumber(
      safeConfig.reminderCooldownMs,
      baseConfig.reminderCooldownMs,
    ),
    staffIds: toStringList(
      safeConfig.staffIds,
      baseConfig.staffIds,
    ),
    telegramBotToken: baseConfig.telegramBotToken || '',
    newAlertChatId: typeof safeConfig.newAlertChatId === 'string'
      ? safeConfig.newAlertChatId.trim()
      : '',
    newAlertThreadId: typeof safeConfig.newAlertThreadId === 'string'
      ? safeConfig.newAlertThreadId.trim()
      : '',
    holdingAlertChatId: typeof safeConfig.holdingAlertChatId === 'string'
      ? safeConfig.holdingAlertChatId.trim()
      : '',
    holdingAlertThreadId: typeof safeConfig.holdingAlertThreadId === 'string'
      ? safeConfig.holdingAlertThreadId.trim()
      : '',
    highestAlertChatId: typeof safeConfig.highestAlertChatId === 'string'
      ? safeConfig.highestAlertChatId.trim()
      : '',
    highestAlertThreadId: typeof safeConfig.highestAlertThreadId === 'string'
      ? safeConfig.highestAlertThreadId.trim()
      : '',
    processingAlertChatId: typeof safeConfig.processingAlertChatId === 'string'
      ? safeConfig.processingAlertChatId.trim()
      : '',
    processingAlertThreadId: typeof safeConfig.processingAlertThreadId === 'string'
      ? safeConfig.processingAlertThreadId.trim()
      : '',
    resolvedAlertChatId: typeof safeConfig.resolvedAlertChatId === 'string'
      ? safeConfig.resolvedAlertChatId.trim()
      : '',
    resolvedAlertThreadId: typeof safeConfig.resolvedAlertThreadId === 'string'
      ? safeConfig.resolvedAlertThreadId.trim()
      : '',
    holdingReplyPatternSources,
    resolveReplyPatternSources,
    customerResolvePatternSources,
    holdingReplyPatterns: buildPatterns(holdingReplyPatternSources),
    resolveReplyPatterns: buildPatterns(resolveReplyPatternSources),
    customerResolvePatterns: buildPatterns(customerResolvePatternSources),
  };
}
