import { OncallStore } from './oncall-store.mjs';
import { TelegramBotClient } from './telegram-bot.mjs';
import { getDefaultOncallConfig, normalizeOncallConfig } from './oncall-config.mjs';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const NON_TEXT_PLACEHOLDER = '[non-text message]';
const CASE_SPLIT_IDLE_MS = 5 * 60 * 1000;
const ONCALL_NOTIFICATION_STAGES = {
  NEW: 'new',
  HOLDING: 'holding',
  HIGHEST: 'highest',
  RESOLVED: 'resolved',
};

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

function getNotificationStage(caseRecord) {
  if (caseRecord.status === 'expired') {
    return undefined;
  }

  if (caseRecord.status === 'resolved') {
    return ONCALL_NOTIFICATION_STAGES.RESOLVED;
  }

  if (caseRecord.escalationLevel >= 2) {
    return ONCALL_NOTIFICATION_STAGES.HIGHEST;
  }

  if (hasHoldingReply(caseRecord)) {
    return ONCALL_NOTIFICATION_STAGES.HOLDING;
  }

  if (!hasEffectiveReply(caseRecord)) {
    return ONCALL_NOTIFICATION_STAGES.NEW;
  }

  return undefined;
}

function buildStageTarget(chatId, threadId) {
  const normalizedChatId = typeof chatId === 'string' ? chatId.trim() : '';
  const normalizedThreadId = typeof threadId === 'string' ? threadId.trim() : '';

  if (!normalizedChatId) {
    return undefined;
  }

  return {
    chatId: normalizedChatId,
    threadId: normalizedThreadId || undefined,
  };
}

function getStageTarget(config, stage) {
  if (stage === ONCALL_NOTIFICATION_STAGES.NEW) {
    return buildStageTarget(config.newAlertChatId, config.newAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.HOLDING) {
    return buildStageTarget(config.holdingAlertChatId, config.holdingAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.HIGHEST) {
    return buildStageTarget(config.highestAlertChatId, config.highestAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.RESOLVED) {
    return buildStageTarget(config.resolvedAlertChatId, config.resolvedAlertThreadId);
  }

  return undefined;
}

function buildNotificationMessage(caseRecord, stage) {
  const stageTitles = {
    [ONCALL_NOTIFICATION_STAGES.NEW]: '[OnCall New Case]',
    [ONCALL_NOTIFICATION_STAGES.HOLDING]: '[OnCall Waiting Reply]',
    [ONCALL_NOTIFICATION_STAGES.HIGHEST]: '[OnCall Highest Escalation]',
    [ONCALL_NOTIFICATION_STAGES.RESOLVED]: '[OnCall Resolved]',
  };
  const lines = [
    stageTitles[stage] || '[OnCall Case]',
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
    notificationStage: undefined,
    notificationChatId: undefined,
    notificationThreadId: undefined,
    notificationMessageId: undefined,
  };

  state.caseIdByChatId[payload.chatId] = nextCase.id;
  state.casesById[nextCase.id] = nextCase;

  return nextCase;
}

function getLastCaseInteractionAt(caseRecord) {
  return [
    caseRecord.reopenedAt,
    caseRecord.resolvedAt,
    caseRecord.processingAt,
    caseRecord.ackedAt,
    caseRecord.lastStaffReplyAt,
    caseRecord.lastHoldingReplyAt,
    caseRecord.lastCustomerMessageAt,
    caseRecord.createdAt,
  ].reduce((latest, value) => (typeof value === 'number' && value > latest ? value : latest), 0);
}

function shouldStartNewCase(existingCase, eventAt) {
  if (!existingCase) {
    return false;
  }

  const lastInteractionAt = getLastCaseInteractionAt(existingCase);
  return Boolean(lastInteractionAt && eventAt - lastInteractionAt >= CASE_SPLIT_IDLE_MS);
}

function rotateChatCase(state, payload, now) {
  const eventAt = payload.createdAt || now;
  const existingCaseId = state.caseIdByChatId[payload.chatId];
  const existingCase = existingCaseId ? state.casesById[existingCaseId] : undefined;

  if (!existingCase || !shouldStartNewCase(existingCase, eventAt)) {
    return existingCase;
  }

  if (existingCase.status !== 'resolved' && existingCase.status !== 'expired') {
    const config = existingCase.oncallConfig || getDefaultOncallConfig();
    existingCase.status = 'expired';
    existingCase.updatedAt = eventAt;
    existingCase.nextEscalateAt = undefined;
    existingCase.deadlineVersion += 1;
    existingCase.oncallConfig = config;
  }

  delete state.caseIdByChatId[payload.chatId];
  return undefined;
}

function findCaseByMessageId(state, chatId, messageId) {
  if (!messageId) {
    return undefined;
  }

  return Object.values(state.casesById).find((caseRecord) => (
    caseRecord.chatId === chatId
    && Array.isArray(caseRecord.messageIds)
    && caseRecord.messageIds.includes(messageId)
  ));
}

function applyUsefulMessageEvent(state, payload, config, now) {
  const staleCaseRecord = rotateChatCase(state, payload, now);
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
  caseRecord.oncallConfig = config;

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
    staleCaseRecord,
    changed: true,
  };
}

function applyStaffReplyEvent(state, payload, config, now) {
  const replyTargetCase = findCaseByMessageId(state, payload.chatId, payload.replyToMessageId);
  const fallbackCaseId = state.caseIdByChatId[payload.chatId];
  const caseRecord = replyTargetCase || (fallbackCaseId ? state.casesById[fallbackCaseId] : undefined);
  if (!caseRecord) {
    return {
      changed: false,
    };
  }

  if (caseRecord.staffMessageIds.includes(payload.messageId)) {
    return {
      caseRecord,
      changed: false,
    };
  }

  const createdAt = payload.createdAt || now;
  const kind = payload.kind || classifyStaffReply(payload.text, config);
  caseRecord.oncallConfig = config;

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

function applyDeadlineEvent(state, payload, now) {
  const caseRecord = state.casesById[payload.caseId];
  if (!caseRecord || caseRecord.deadlineVersion !== payload.deadlineVersion) {
    return {
      changed: false,
      caseRecord,
    };
  }

  const config = caseRecord.oncallConfig || getDefaultOncallConfig();

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
    }
  }

  return {
    changed: true,
    caseRecord,
  };
}

function applyCaseStatusEvent(state, payload, now) {
  const caseRecord = state.casesById[payload.caseId];
  if (!caseRecord) {
    return {
      changed: false,
      error: 'case_not_found',
    };
  }

  if (caseRecord.status === 'resolved' || caseRecord.status === 'expired') {
    return {
      changed: false,
      caseRecord,
      error: 'case_not_active',
    };
  }

  const nextStatus = payload.status;
  const updatedAt = payload.createdAt || now;
  const ownerUserId = payload.userId || caseRecord.ownerUserId;

  caseRecord.updatedAt = updatedAt;
  caseRecord.ownerUserId = ownerUserId;
  caseRecord.lastEffectiveResponderId = ownerUserId || caseRecord.lastEffectiveResponderId;

  if (nextStatus === 'acked') {
    caseRecord.status = 'acked';
    caseRecord.ackedAt = caseRecord.ackedAt || updatedAt;
  } else if (nextStatus === 'processing') {
    caseRecord.status = 'processing';
    caseRecord.ackedAt = caseRecord.ackedAt || updatedAt;
    caseRecord.processingAt = updatedAt;
  } else if (nextStatus === 'resolved') {
    caseRecord.status = 'resolved';
    caseRecord.ackedAt = caseRecord.ackedAt || updatedAt;
    caseRecord.processingAt = caseRecord.processingAt || updatedAt;
    caseRecord.resolvedAt = updatedAt;
  } else {
    return {
      changed: false,
      caseRecord,
      error: 'unsupported_status',
    };
  }

  const config = caseRecord.oncallConfig || getDefaultOncallConfig();
  caseRecord.nextEscalateAt = nextStatus === 'resolved'
    ? undefined
    : computeNextEscalateAt(caseRecord, config);
  caseRecord.deadlineVersion += 1;

  return {
    changed: true,
    caseRecord,
  };
}

export function sanitizeOncallCaseForResponse(caseRecord) {
  if (!caseRecord) {
    return caseRecord;
  }

  const { oncallConfig: _oncallConfig, ...rest } = caseRecord;
  return rest;
}

export class OncallService {
  constructor({ log }) {
    this.log = log;
    this.store = new OncallStore(undefined, log);
    this.botClient = new TelegramBotClient(log);
    this.timersByCaseId = new Map();
    this.defaultConfig = getDefaultOncallConfig();
  }

  async init() {
    await this.store.init();
  }

  async ingestUsefulMessage(payload) {
    const config = normalizeOncallConfig(payload.oncallConfig, this.defaultConfig);
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
      if (result.staleCaseRecord) {
        this.syncCaseSchedule(result.staleCaseRecord);
        await this.syncCaseNotification(result.staleCaseRecord);
      }
      this.syncCaseSchedule(result.caseRecord);
      await this.syncCaseNotification(result.caseRecord);
    }

    return result;
  }

  async reportStaffReply(payload) {
    const config = normalizeOncallConfig(payload.oncallConfig, this.defaultConfig);
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
      await this.syncCaseNotification(result.caseRecord);
    }

    return result;
  }

  async handleDeadlineReached(caseId, deadlineVersion) {
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyDeadlineEvent(state, { caseId, deadlineVersion }, now)
    ));

    if (result.caseRecord) {
      this.log('Oncall deadline reached', {
        caseId,
        deadlineVersion,
        status: result.caseRecord.status,
        nextEscalateAt: result.caseRecord.nextEscalateAt,
        escalationLevel: result.caseRecord.escalationLevel,
      });
      this.syncCaseSchedule(result.caseRecord);
      await this.syncCaseNotification(result.caseRecord);
    }
  }

  async listCases(chatId) {
    return this.store.read((state) => {
      const cases = Object.values(state.casesById || {});
      if (!chatId) {
        return cases.map(sanitizeOncallCaseForResponse);
      }

      return cases
        .filter((caseRecord) => caseRecord.chatId === chatId)
        .map(sanitizeOncallCaseForResponse);
    });
  }

  async updateCaseStatus(payload) {
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyCaseStatusEvent(state, payload, now)
    ));

    if (result.caseRecord) {
      this.log('Oncall case status updated', {
        caseId: payload.caseId,
        status: result.caseRecord.status,
        nextEscalateAt: result.caseRecord.nextEscalateAt,
        escalationLevel: result.caseRecord.escalationLevel,
        error: result.error,
      });
      this.syncCaseSchedule(result.caseRecord);
      await this.syncCaseNotification(result.caseRecord);
    }

    return result;
  }

  async setCaseNotification(caseId, nextState) {
    await this.store.mutate((state) => {
      const caseRecord = state.casesById[caseId];
      if (!caseRecord) {
        return undefined;
      }

      caseRecord.notificationStage = nextState?.stage;
      caseRecord.notificationChatId = nextState?.chatId;
      caseRecord.notificationThreadId = nextState?.threadId;
      caseRecord.notificationMessageId = nextState?.messageId;
      return undefined;
    });
  }

  async syncCaseNotification(caseRecord) {
    if (!caseRecord) {
      return;
    }

    const config = caseRecord.oncallConfig || this.defaultConfig;
    const nextStage = getNotificationStage(caseRecord);
    const nextTarget = nextStage ? getStageTarget(config, nextStage) : undefined;
    const currentTargetConfig = (
      caseRecord.notificationChatId
        ? {
          telegramBotToken: config.telegramBotToken,
          telegramAlertChatId: caseRecord.notificationChatId,
          telegramAlertThreadId: caseRecord.notificationThreadId,
        }
        : undefined
    );
    const sameStage = nextStage === caseRecord.notificationStage;
    const sameChat = (nextTarget?.chatId || '') === (caseRecord.notificationChatId || '');
    const sameThread = (nextTarget?.threadId || '') === (caseRecord.notificationThreadId || '');

    if (!nextStage || !nextTarget?.chatId) {
      if (currentTargetConfig && caseRecord.notificationMessageId) {
        await this.botClient.deleteMessage(currentTargetConfig, caseRecord.notificationMessageId);
      }

      if (caseRecord.notificationMessageId || caseRecord.notificationChatId) {
        await this.setCaseNotification(caseRecord.id, undefined);
      }
      return;
    }

    if (sameStage && sameChat && sameThread && caseRecord.notificationMessageId) {
      return;
    }

    const nextBotConfig = {
      telegramBotToken: config.telegramBotToken,
      telegramAlertChatId: nextTarget.chatId,
      telegramAlertThreadId: nextTarget.threadId,
    };
    const sendResult = await this.botClient.sendAlert(
      nextBotConfig,
      buildNotificationMessage(caseRecord, nextStage),
    );

    if (!sendResult?.ok || !sendResult.messageId) {
      return;
    }

    if (currentTargetConfig && caseRecord.notificationMessageId) {
      await this.botClient.deleteMessage(currentTargetConfig, caseRecord.notificationMessageId);
    }

    await this.setCaseNotification(caseRecord.id, {
      stage: nextStage,
      chatId: nextTarget.chatId,
      threadId: nextTarget.threadId || '',
      messageId: sendResult.messageId,
    });
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
  const service = new OncallService({
    log,
  });

  await service.init();
  return service;
}
