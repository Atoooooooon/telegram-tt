import { getDevRedis } from './dev-redis.mjs';
import { getDefaultOncallConfig, normalizeOncallConfig } from './oncall-config.mjs';
import { REDIS_KEYS } from './redis-keys.mjs';
import { TelegramBotClient } from './telegram-bot.mjs';

const DEFAULT_GATE_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_GATE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GATE_TEXT_LENGTH = 2000;
const MAX_CONTROL_MESSAGE_LENGTH = 3900;
const MAX_CONTEXT_VALUE_LENGTH = 1200;
const APPROVE_PATTERN = /^(ok|okay|yes|y|1|１|approve|approved|continue|确认|同意|继续|通过|可以|好了)$/i;

function getNow() {
  return Date.now();
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function getString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function getNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function truncateText(value, fallback) {
  const text = getString(value) || fallback;
  return text.length > MAX_GATE_TEXT_LENGTH ? `${text.slice(0, MAX_GATE_TEXT_LENGTH)}...` : text;
}

function truncateValue(value, maxLength = MAX_CONTEXT_VALUE_LENGTH) {
  const text = getString(value);
  if (!text) {
    return undefined;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function parseGate(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function createGateId() {
  return `suspend:${getNow()}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeDecisionContext(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return undefined;
  }

  const result = {};
  for (const [key, value] of Object.entries(rawValue).slice(0, 32)) {
    const normalizedKey = getString(key);
    if (!normalizedKey || value === undefined || (!value && typeof value === 'object')) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      const normalizedValue = truncateValue(String(value));
      if (normalizedValue) {
        result[normalizedKey] = normalizedValue;
      }
      continue;
    }

    try {
      const normalizedValue = truncateValue(JSON.stringify(value));
      if (normalizedValue) {
        result[normalizedKey] = normalizedValue;
      }
    } catch {
      // Ignore non-serializable values in operator-facing context.
    }
  }

  return Object.keys(result).length ? result : undefined;
}

function formatDecisionContext(context) {
  if (!context || typeof context !== 'object') {
    return [];
  }

  const fieldLabels = [
    ['orderNumber', '订单'],
    ['caseId', 'Case'],
    ['ruleName', 'Playbook'],
    ['stepId', '暂停步骤'],
    ['dfReplyText', '/df 返回'],
    ['dolistReplyText', '/dolist 返回'],
    ['ssn', 'SSN'],
    ['supplierName', '供应商'],
    ['switchMatchedValue', '路由命中'],
    ['upstreamAlias', '上游别名'],
    ['targetChatId', '目标上游群'],
    ['plannedDraft', '准备草稿'],
    ['caseSummary', 'Case 摘要'],
    ['caseText', 'Case 原文'],
  ];

  const lines = [];
  const usedKeys = new Set();

  for (const [key, label] of fieldLabels) {
    const value = truncateValue(context[key]);
    if (!value) {
      continue;
    }

    usedKeys.add(key);
    lines.push(`${label}: ${value}`);
  }

  for (const [key, value] of Object.entries(context)) {
    if (usedKeys.has(key)) {
      continue;
    }

    const normalizedValue = truncateValue(value);
    if (normalizedValue) {
      lines.push(`${key}: ${normalizedValue}`);
    }
  }

  return lines;
}

function getAlertTarget(config, payload) {
  const controlChatId = getString(payload.controlChatId)
    || config.suspendConfirmChatId
    || config.newAlertChatId
    || config.processingAlertChatId
    || config.highestAlertChatId
    || config.holdingAlertChatId;
  const controlThreadId = getString(payload.controlThreadId)
    || (
      controlChatId === config.suspendConfirmChatId ? config.suspendConfirmThreadId : undefined
    )
    || (
      controlChatId === config.newAlertChatId ? config.newAlertThreadId : undefined
    )
    || (
      controlChatId === config.processingAlertChatId ? config.processingAlertThreadId : undefined
    )
    || (
      controlChatId === config.highestAlertChatId ? config.highestAlertThreadId : undefined
    )
    || (
      controlChatId === config.holdingAlertChatId ? config.holdingAlertThreadId : undefined
    );

  return {
    controlChatId,
    controlThreadId,
  };
}

function buildControlMessage(gate) {
  const lines = [
    `【客服流程暂停】${gate.title}`,
    '',
    gate.prompt,
    '',
    `Gate: ${gate.id}`,
    gate.orderNumber ? `订单: ${gate.orderNumber}` : undefined,
    gate.ruleName ? `Playbook: ${gate.ruleName}` : undefined,
    gate.stepId ? `Step: ${gate.stepId}` : undefined,
    gate.sourceChatId ? `来源群: ${gate.sourceChatId}` : undefined,
    gate.sourceMessageId ? `来源消息: ${gate.sourceMessageId}` : undefined,
    ...(
      gate.decisionContext ? [
        '',
        '【决策信息】',
        ...formatDecisionContext(gate.decisionContext),
      ] : []
    ),
    '',
    '确认继续：reply 1 / OK / 确认 / 继续',
    '拒绝停止：reply 任意其他文本',
    '超时说明：超时只会让本次 gate 过期，不会自动发送上游消息；仍可人工处理。',
    `过期时间: ${new Date(gate.expiresAt).toISOString()}`,
  ];

  const text = lines.filter(Boolean).join('\n');
  return text.length > MAX_CONTROL_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_CONTROL_MESSAGE_LENGTH - 18)}\n...(已截断)`
    : text;
}

function sanitizeGate(gate) {
  if (!gate) {
    return undefined;
  }

  return {
    id: gate.id,
    idempotencyKey: gate.idempotencyKey,
    status: gate.status,
    title: gate.title,
    prompt: gate.prompt,
    sourceChatId: gate.sourceChatId,
    sourceMessageId: gate.sourceMessageId,
    caseId: gate.caseId,
    orderNumber: gate.orderNumber,
    ruleId: gate.ruleId,
    ruleName: gate.ruleName,
    stepId: gate.stepId,
    decisionContext: gate.decisionContext,
    controlChatId: gate.controlChatId,
    controlThreadId: gate.controlThreadId,
    controlMessageId: gate.controlMessageId,
    createdAt: gate.createdAt,
    expiresAt: gate.expiresAt,
    approvedAt: gate.approvedAt,
    approvedBy: gate.approvedBy,
    approvalText: gate.approvalText,
    rejectedAt: gate.rejectedAt,
    rejectedBy: gate.rejectedBy,
    rejectionText: gate.rejectionText,
    error: gate.error,
  };
}

export class CustomerServiceSuspendGateService {
  constructor({ log }) {
    this.log = log;
    this.botClient = new TelegramBotClient(log);
    this.defaultConfig = getDefaultOncallConfig();
    this.pollIntervalMs = Math.max(
      1000,
      getNumber(process.env.CUSTOMER_SERVICE_SUSPEND_POLL_INTERVAL_MS) || DEFAULT_POLL_INTERVAL_MS,
    );
    this.retentionMs = Math.max(
      60 * 60 * 1000,
      getNumber(process.env.CUSTOMER_SERVICE_SUSPEND_RETENTION_MS) || DEFAULT_GATE_RETENTION_MS,
    );
    this.pollTimer = undefined;
    this.isPolling = false;
    this.nextUpdateOffset = undefined;
  }

  async getRedis() {
    const redis = await getDevRedis(this.log);
    if (!redis) {
      throw new Error('Redis is not configured');
    }

    return redis;
  }

  async saveGate(redis, gate) {
    await redis.hset(REDIS_KEYS.CUSTOMER_SERVICE_SUSPEND_GATES, gate.id, JSON.stringify(gate));
  }

  async getGateRecord(gateId) {
    const id = getString(gateId);
    if (!id) {
      return undefined;
    }

    const redis = await this.getRedis();
    const gate = parseGate(await redis.hget(REDIS_KEYS.CUSTOMER_SERVICE_SUSPEND_GATES, id));
    if (!gate) {
      return undefined;
    }

    if (gate.status === 'pending' && gate.expiresAt <= getNow()) {
      const expiredGate = {
        ...gate,
        status: 'expired',
        error: 'Suspend gate expired',
      };
      await this.saveGate(redis, expiredGate);
      return expiredGate;
    }

    return gate;
  }

  async getGate(gateId) {
    return sanitizeGate(await this.getGateRecord(gateId));
  }

  shouldPruneGate(gate, now) {
    if (!gate || gate.status === 'pending') {
      return false;
    }

    const terminalAt = getNumber(gate.approvedAt)
      || getNumber(gate.rejectedAt)
      || getNumber(gate.expiresAt)
      || getNumber(gate.createdAt);
    return Boolean(terminalAt && terminalAt + this.retentionMs <= now);
  }

  async readGateEntries(redis) {
    const records = await redis.hgetall(REDIS_KEYS.CUSTOMER_SERVICE_SUSPEND_GATES);
    return Object.entries(records).map(([fieldId, rawValue]) => ({
      fieldId,
      gate: parseGate(rawValue),
    }));
  }

  async pruneGateFields(redis, fieldIds) {
    if (!fieldIds.length) {
      return;
    }

    await redis.hdel(REDIS_KEYS.CUSTOMER_SERVICE_SUSPEND_GATES, ...fieldIds);
  }

  async findExistingGate(redis, idempotencyKey) {
    const key = getString(idempotencyKey);
    if (!key) {
      return undefined;
    }

    const now = getNow();
    const staleFieldIds = [];

    for (const { fieldId, gate } of await this.readGateEntries(redis)) {
      if (!gate) {
        staleFieldIds.push(fieldId);
        continue;
      }

      if (this.shouldPruneGate(gate, now)) {
        staleFieldIds.push(fieldId);
        continue;
      }

      if (
        gate
        && gate.idempotencyKey === key
        && gate.status === 'pending'
        && gate.expiresAt > now
      ) {
        await this.pruneGateFields(redis, staleFieldIds);
        return gate;
      }
    }

    await this.pruneGateFields(redis, staleFieldIds);
    return undefined;
  }

  async createGate(payload = {}) {
    const redis = await this.getRedis();
    const existingGate = await this.findExistingGate(redis, payload.idempotencyKey);
    if (existingGate) {
      this.ensurePolling();
      return sanitizeGate(existingGate);
    }

    const config = normalizeOncallConfig(payload.oncallConfig, this.defaultConfig);
    const { controlChatId, controlThreadId } = getAlertTarget(config, payload);

    if (!config.telegramBotToken) {
      throw new Error('ONCALL_TELEGRAM_BOT_TOKEN is required for suspend gates');
    }

    if (!controlChatId) {
      throw new Error('A control alert chat is required for suspend gates');
    }

    const now = getNow();
    const timeoutMs = Math.max(60 * 1000, getNumber(payload.timeoutMs) || DEFAULT_GATE_TIMEOUT_MS);
    const gate = {
      id: createGateId(),
      idempotencyKey: getString(payload.idempotencyKey),
      status: 'pending',
      title: truncateText(payload.title, '等待人工确认'),
      prompt: truncateText(payload.prompt, '请确认后 reply 1 / OK 继续。'),
      sourceChatId: getString(payload.sourceChatId),
      sourceMessageId: getNumber(payload.sourceMessageId),
      caseId: getString(payload.caseId),
      orderNumber: getString(payload.orderNumber),
      ruleId: getString(payload.ruleId),
      ruleName: getString(payload.ruleName),
      stepId: getString(payload.stepId),
      decisionContext: normalizeDecisionContext(payload.decisionContext),
      controlChatId,
      controlThreadId,
      controlMessageId: undefined,
      createdAt: now,
      expiresAt: now + timeoutMs,
    };

    const sendResult = await this.botClient.sendAlert(
      {
        telegramBotToken: config.telegramBotToken,
        telegramAlertChatId: controlChatId,
        telegramAlertThreadId: controlThreadId,
      },
      buildControlMessage(gate),
    );

    if (!sendResult?.ok || !sendResult.messageId) {
      throw new Error('Failed to send suspend gate confirmation message');
    }

    const nextGate = {
      ...gate,
      controlMessageId: sendResult.messageId,
    };
    await this.saveGate(redis, nextGate);
    this.ensurePolling();

    return sanitizeGate(nextGate);
  }

  async listPendingGates(redis) {
    const now = getNow();
    const pending = [];
    const staleFieldIds = [];

    for (const { fieldId, gate } of await this.readGateEntries(redis)) {
      if (!gate) {
        staleFieldIds.push(fieldId);
        continue;
      }

      if (this.shouldPruneGate(gate, now)) {
        staleFieldIds.push(fieldId);
        continue;
      }

      if (gate.status !== 'pending') {
        continue;
      }

      if (gate.expiresAt <= now) {
        await this.saveGate(redis, {
          ...gate,
          status: 'expired',
          error: 'Suspend gate expired',
        });
        continue;
      }

      pending.push(gate);
    }

    await this.pruneGateFields(redis, staleFieldIds);
    return pending;
  }

  ensurePolling() {
    if (this.pollTimer) {
      return;
    }

    this.pollTimer = setInterval(() => {
      void this.pollTelegramUpdates().catch((error) => {
        const errorMessage = getErrorMessage(error);
        this.log('Customer service suspend gate poll failed', {
          error: errorMessage,
        });
        if (errorMessage.includes('Redis is not configured')) {
          this.stopPolling();
        }
      });
    }, this.pollIntervalMs);

    void this.pollTelegramUpdates().catch((error) => {
      const errorMessage = getErrorMessage(error);
      this.log('Customer service suspend gate initial poll failed', {
        error: errorMessage,
      });
      if (errorMessage.includes('Redis is not configured')) {
        this.stopPolling();
      }
    });
  }

  stopPolling() {
    if (!this.pollTimer) {
      return;
    }

    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  async pollTelegramUpdates() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      const redis = await this.getRedis();
      const pendingGates = await this.listPendingGates(redis);
      if (!pendingGates.length) {
        this.stopPolling();
        return;
      }

      if (!this.defaultConfig.telegramBotToken) {
        this.stopPolling();
        return;
      }

      const result = await this.botClient.getUpdates(
        { telegramBotToken: this.defaultConfig.telegramBotToken },
        this.nextUpdateOffset ? { offset: this.nextUpdateOffset } : {},
      );
      if (!result.ok || !result.updates.length) {
        return;
      }

      const processedGateIds = new Set();
      for (const update of result.updates) {
        if (Number.isFinite(update.update_id)) {
          this.nextUpdateOffset = Number(update.update_id) + 1;
        }

        const message = update.message;
        if (!message?.reply_to_message?.message_id) {
          continue;
        }

        const chatId = message.chat?.id !== undefined ? String(message.chat.id) : undefined;
        const replyToMessageId = Number(message.reply_to_message.message_id);
        const text = getString(message.text) || getString(message.caption);
        if (!chatId || !replyToMessageId || !text) {
          continue;
        }

        const matchedGate = pendingGates.find((gate) => (
          !processedGateIds.has(gate.id)
          && gate.controlChatId === chatId
          && Number(gate.controlMessageId) === replyToMessageId
          && (
            !gate.controlThreadId
            || String(message.message_thread_id || '') === String(gate.controlThreadId)
            || String(message.reply_to_message.message_thread_id || '') === String(gate.controlThreadId)
          )
        ));

        if (!matchedGate) {
          continue;
        }

        if (APPROVE_PATTERN.test(text)) {
          await this.saveGate(redis, {
            ...matchedGate,
            status: 'approved',
            approvedAt: getNow(),
            approvedBy: message.from?.id !== undefined ? String(message.from.id) : undefined,
            approvalText: text,
          });
          processedGateIds.add(matchedGate.id);
        } else {
          await this.saveGate(redis, {
            ...matchedGate,
            status: 'rejected',
            rejectedAt: getNow(),
            rejectedBy: message.from?.id !== undefined ? String(message.from.id) : undefined,
            rejectionText: text,
          });
          processedGateIds.add(matchedGate.id);
        }
      }
    } finally {
      this.isPolling = false;
    }
  }

  close() {
    this.stopPolling();
  }
}

export function createCustomerServiceSuspendGateService(log) {
  const service = new CustomerServiceSuspendGateService({ log });
  service.ensurePolling();
  return service;
}
