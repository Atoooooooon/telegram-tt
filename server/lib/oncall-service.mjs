import { OncallStore } from './oncall-store.mjs';
import { TelegramBotClient } from './telegram-bot.mjs';
import { OncallConfigProvider } from './oncall-config.mjs';
import { getDevRedis } from './dev-redis.mjs';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const NON_TEXT_PLACEHOLDER = '[non-text message]';

function appendUnique(list, value) {
  if (!Array.isArray(list)) {
    return [value];
  }

  return list.includes(value) ? list : [...list, value];
}

function createCaseId(chatId, createdAt) {
  return `${chatId}:${createdAt}:${Math.random().toString(36).slice(2, 8)}`;
}

function getNow() {
  return Date.now();
}

function getNormalizedText(text, previewText) {
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  if (typeof previewText === 'string' && previewText.trim()) {
    return previewText.trim();
  }

  return NON_TEXT_PLACEHOLDER;
}

function hasEffectiveReply(caseRecord) {
  return Boolean(
    caseRecord.lastStaffReplyAt
    && caseRecord.lastCustomerMessageAt
    && caseRecord.lastStaffReplyAt >= caseRecord.lastCustomerMessageAt,
  );
}

function hasHoldingReply(caseRecord) {
  return Boolean(
    caseRecord.lastHoldingReplyAt
    && caseRecord.lastCustomerMessageAt
    && caseRecord.lastHoldingReplyAt >= caseRecord.lastCustomerMessageAt
    && !hasEffectiveReply(caseRecord)
  );
}

function computeNextEscalateAt(caseRecord, config) {
  if (caseRecord.status === 'resolved' || caseRecord.status === 'expired') {
    return undefined;
  }

  if (!caseRecord.lastCustomerMessageAt) {
    return undefined;
  }

  if (hasEffectiveReply(caseRecord)) {
    return undefined;
  }

  if (hasHoldingReply(caseRecord)) {
    if (caseRecord.escalationLevel >= 2) {
      return undefined;
    }

    return caseRecord.lastHoldingReplyAt + config.holdingReplyGraceTimeoutMs;
  }

  if (caseRecord.escalationLevel <= 0) {
    return caseRecord.lastCustomerMessageAt + config.firstResponseTimeoutMs;
  }

  if (caseRecord.escalationLevel === 1) {
    return caseRecord.lastCustomerMessageAt + config.highestEscalationTimeoutMs;
  }

  return undefined;
}

function buildAlertMessage(caseRecord) {
  const lines = [
    '[OnCall Highest Escalation]',
    `caseId: ${caseRecord.id}`,
    `chatId: ${caseRecord.chatId}`,
  ];

  if (caseRecord.chatTitle) {
    lines.push(`chatTitle: ${caseRecord.chatTitle}`);
  }

  lines.push(`status: ${caseRecord.status}`);
  lines.push(`priority: ${caseRecord.priority}`);
  lines.push(`escalationLevel: ${caseRecord.escalationLevel}`);
  lines.push(`latestCustomerMessage: ${caseRecord.lastCustomerText || NON_TEXT_PLACEHOLDER}`);

  if (caseRecord.lastHoldingReplyText) {
    lines.push(`lastHoldingReply: ${caseRecord.lastHoldingReplyText}`);
  }

  if (caseRecord.lastStaffReplyText) {
    lines.push(`lastStaffReply: ${caseRecord.lastStaffReplyText}`);
  }

  return lines.join('\n');
}

function classifyStaffReply(text, config) {
  const normalizedText = (text || '').trim();
  if (!normalizedText) {
    return 'real_reply';
  }

  if (config.resolveReplyPatterns.some((pattern) => pattern.test(normalizedText))) {
    return 'resolve_reply';
  }

  if (config.holdingReplyPatterns.some((pattern) => pattern.test(normalizedText))) {
    return 'holding_reply';
  }

  return 'real_reply';
}

function ensureCaseForChat(state, payload, now) {
  const existingCaseId = state.caseIdByChatId[payload.chatId];
  const existingCase = existingCaseId ? state.casesById[existingCaseId] : undefined;

  if (existingCase) {
    return existingCase;
  }

  const nextCase = {
    id: createCaseId(payload.chatId, payload.createdAt || now),
    chatId: payload.chatId,
    chatTitle: payload.chatTitle,
    senderId: payload.senderId,
    senderName: payload.senderName,
    status: 'new',
    priority: 'normal',
    ownerUserId: undefined,
    messageIds: [],
    staffMessageIds: [],
    firstMessageId: payload.messageId,
    lastMessageId: payload.messageId,
    createdAt: payload.createdAt || now,
    updatedAt: payload.createdAt || now,
    lastCustomerMessageAt: payload.createdAt || now,
    ackedAt: undefined,
    processingAt: undefined,
    resolvedAt: undefined,
    reopenedAt: undefined,
    escalationLevel: 0,
    summary: getNormalizedText(payload.text, payload.previewText),
    lastCustomerText: getNormalizedText(payload.text, payload.previewText),
    lastHoldingReplyText: undefined,
    lastStaffReplyText: undefined,
    lastStaffReplyAt: undefined,
    lastHoldingReplyAt: undefined,
    lastEffectiveResponderId: undefined,
    nextEscalateAt: undefined,
    deadlineVersion: 0,
    lastAlertAt: undefined,
    highestAlertSentAt: undefined,
  };

  state.caseIdByChatId[payload.chatId] = nextCase.id;
  state.casesById[nextCase.id] = nextCase;

  return nextCase;
}

function applyUsefulMessageEvent(state, payload, config, now) {
  const caseRecord = ensureCaseForChat(state, payload, now);

  if (caseRecord.messageIds.includes(payload.messageId)) {
    return {
      caseRecord,
      changed: false,
    };
  }

  caseRecord.chatTitle = payload.chatTitle || caseRecord.chatTitle;
  caseRecord.senderId = payload.senderId || caseRecord.senderId;
  caseRecord.senderName = payload.senderName || caseRecord.senderName;
  caseRecord.messageIds = appendUnique(caseRecord.messageIds, payload.messageId);
  caseRecord.firstMessageId = caseRecord.messageIds[0] || payload.messageId;
  caseRecord.lastMessageId = payload.messageId;
  caseRecord.updatedAt = payload.createdAt || now;
  caseRecord.lastCustomerMessageAt = payload.createdAt || now;
  caseRecord.summary = getNormalizedText(payload.text, payload.previewText);
  caseRecord.lastCustomerText = getNormalizedText(payload.text, payload.previewText);
  caseRecord.ownerUserId = undefined;
  caseRecord.ackedAt = undefined;
  caseRecord.processingAt = undefined;
  caseRecord.resolvedAt = undefined;
  caseRecord.lastAlertAt = undefined;
  caseRecord.highestAlertSentAt = undefined;
  caseRecord.escalationLevel = 0;
  caseRecord.priority = 'normal';

  if (caseRecord.status === 'resolved' || caseRecord.status === 'expired') {
    caseRecord.status = 'reopened';
    caseRecord.reopenedAt = payload.createdAt || now;
  } else {
    caseRecord.status = 'new';
  }

  caseRecord.nextEscalateAt = computeNextEscalateAt(caseRecord, config);
  caseRecord.deadlineVersion += 1;

  return {
    caseRecord,
    changed: true,
  };
}

function applyStaffReplyEvent(state, payload, config, now) {
  const caseId = state.caseIdByChatId[payload.chatId];
  if (!caseId) {
    return {
      changed: false,
    };
  }

  const caseRecord = state.casesById[caseId];
  if (!caseRecord || caseRecord.staffMessageIds.includes(payload.messageId)) {
    return {
      caseRecord,
      changed: false,
    };
  }

  const createdAt = payload.createdAt || now;
  const kind = payload.kind || classifyStaffReply(payload.text, config);

  caseRecord.staffMessageIds = appendUnique(caseRecord.staffMessageIds, payload.messageId);
  caseRecord.updatedAt = createdAt;
  caseRecord.ownerUserId = payload.staffUserId || caseRecord.ownerUserId;
  caseRecord.lastEffectiveResponderId = payload.staffUserId || caseRecord.lastEffectiveResponderId;

  if (kind === 'holding_reply') {
    caseRecord.status = 'acked';
    caseRecord.ackedAt = createdAt;
    caseRecord.lastHoldingReplyAt = createdAt;
    caseRecord.lastHoldingReplyText = getNormalizedText(payload.text, payload.previewText);
  } else if (kind === 'resolve_reply') {
    caseRecord.status = 'resolved';
    caseRecord.ackedAt = caseRecord.ackedAt || createdAt;
    caseRecord.lastStaffReplyAt = createdAt;
    caseRecord.lastStaffReplyText = getNormalizedText(payload.text, payload.previewText);
    caseRecord.resolvedAt = createdAt;
  } else {
    caseRecord.status = 'acked';
    caseRecord.ackedAt = caseRecord.ackedAt || createdAt;
    caseRecord.lastStaffReplyAt = createdAt;
    caseRecord.lastStaffReplyText = getNormalizedText(payload.text, payload.previewText);
  }

  caseRecord.nextEscalateAt = computeNextEscalateAt(caseRecord, config);
  caseRecord.deadlineVersion += 1;

  return {
    caseRecord,
    changed: true,
  };
}

function applyDeadlineEvent(state, payload, config, now) {
  const caseRecord = state.casesById[payload.caseId];
  if (!caseRecord || caseRecord.deadlineVersion !== payload.deadlineVersion) {
    return {
      changed: false,
      caseRecord,
    };
  }

  const nextEscalateAt = computeNextEscalateAt(caseRecord, config);
  if (!nextEscalateAt) {
    caseRecord.nextEscalateAt = undefined;
    caseRecord.deadlineVersion += 1;
    return {
      changed: true,
      caseRecord,
    };
  }

  if (nextEscalateAt > now) {
    caseRecord.nextEscalateAt = nextEscalateAt;
    caseRecord.deadlineVersion += 1;
    return {
      changed: true,
      caseRecord,
    };
  }

  let shouldSendAlert = false;

  if (hasHoldingReply(caseRecord)) {
    if (caseRecord.escalationLevel < 2) {
      caseRecord.escalationLevel = 2;
      caseRecord.priority = 'urgent';
      caseRecord.status = caseRecord.status === 'resolved' ? 'resolved' : 'new';
      shouldSendAlert = true;
    }
  } else if (caseRecord.escalationLevel <= 0) {
    caseRecord.escalationLevel = 1;
    caseRecord.priority = 'high';
  } else if (caseRecord.escalationLevel === 1) {
    caseRecord.escalationLevel = 2;
    caseRecord.priority = 'urgent';
    shouldSendAlert = true;
  }

  caseRecord.updatedAt = now;
  caseRecord.lastAlertAt = now;
  caseRecord.nextEscalateAt = computeNextEscalateAt(caseRecord, config);
  caseRecord.deadlineVersion += 1;

  if (shouldSendAlert) {
    const canSend = !caseRecord.highestAlertSentAt
      || now - caseRecord.highestAlertSentAt >= config.reminderCooldownMs;

    if (canSend) {
      caseRecord.highestAlertSentAt = now;
      return {
        changed: true,
        caseRecord,
        alertText: buildAlertMessage(caseRecord),
      };
    }
  }

  return {
    changed: true,
    caseRecord,
  };
}

export class OncallService {
  constructor({ configProvider, log }) {
    this.configProvider = configProvider;
    this.log = log;
    this.store = new OncallStore(undefined, log);
    this.botClient = new TelegramBotClient(log);
    this.timersByCaseId = new Map();
  }

  async init() {
    await this.store.init();
  }

  async ingestUsefulMessage(payload) {
    const config = await this.configProvider.getConfig();
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyUsefulMessageEvent(state, payload, config, now)
    ));

    if (result.caseRecord) {
      this.log('Oncall useful message ingested', {
        chatId: payload.chatId,
        messageId: payload.messageId,
        status: result.caseRecord.status,
        nextEscalateAt: result.caseRecord.nextEscalateAt,
        escalationLevel: result.caseRecord.escalationLevel,
      });
      this.syncCaseSchedule(result.caseRecord);
    }

    return result;
  }

  async reportStaffReply(payload) {
    const config = await this.configProvider.getConfig();
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyStaffReplyEvent(state, payload, config, now)
    ));

    if (result.caseRecord) {
      this.log('Oncall staff reply reported', {
        chatId: payload.chatId,
        messageId: payload.messageId,
        status: result.caseRecord.status,
        nextEscalateAt: result.caseRecord.nextEscalateAt,
        escalationLevel: result.caseRecord.escalationLevel,
      });
      this.syncCaseSchedule(result.caseRecord);
    }

    return result;
  }

  async handleDeadlineReached(caseId, deadlineVersion) {
    const config = await this.configProvider.getConfig();
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyDeadlineEvent(state, { caseId, deadlineVersion }, config, now)
    ));

    if (result.caseRecord) {
      this.log('Oncall deadline reached', {
        caseId,
        deadlineVersion,
        status: result.caseRecord.status,
        nextEscalateAt: result.caseRecord.nextEscalateAt,
        escalationLevel: result.caseRecord.escalationLevel,
        alert: Boolean(result.alertText),
      });
      this.syncCaseSchedule(result.caseRecord);
    }

    if (result.alertText) {
      try {
        await this.botClient.sendAlert(config, result.alertText);
      } catch (error) {
        this.log('Oncall highest escalation alert failed', error);
      }
    }
  }

  async listCases(chatId) {
    return this.store.read((state) => {
      const cases = Object.values(state.casesById || {});
      if (!chatId) {
        return cases;
      }

      return cases.filter((caseRecord) => caseRecord.chatId === chatId);
    });
  }

  async getResolvedConfig(options) {
    return this.configProvider.getConfig(options);
  }

  getConfigKey() {
    return this.configProvider.getConfigKey();
  }

  syncCaseSchedule(caseRecord) {
    this.clearCaseSchedule(caseRecord.id);

    if (!caseRecord.nextEscalateAt) {
      return;
    }

    this.scheduleOnce(caseRecord.id, caseRecord.deadlineVersion, caseRecord.nextEscalateAt);
  }

  clearCaseSchedule(caseId) {
    const existing = this.timersByCaseId.get(caseId);
    if (!existing) {
      return;
    }

    clearTimeout(existing.timeoutId);
    this.timersByCaseId.delete(caseId);
  }

  scheduleOnce(caseId, deadlineVersion, targetAt) {
    const delay = Math.max(0, targetAt - getNow());
    const effectiveDelay = Math.min(delay, MAX_TIMER_DELAY_MS);

    const timeoutId = setTimeout(() => {
      this.timersByCaseId.delete(caseId);

      if (delay > MAX_TIMER_DELAY_MS) {
        this.scheduleOnce(caseId, deadlineVersion, targetAt);
        return;
      }

      void this.handleDeadlineReached(caseId, deadlineVersion);
    }, effectiveDelay);

    this.timersByCaseId.set(caseId, { timeoutId, deadlineVersion, targetAt });
  }
}

export async function createOncallService(log) {
  const redis = await getDevRedis(log);
  const configProvider = new OncallConfigProvider(redis, log);
  const service = new OncallService({
    configProvider,
    log,
  });

  await service.init();
  return service;
}
