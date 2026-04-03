import { getDefaultOncallConfig } from './oncall-config.mjs';

const NON_TEXT_PLACEHOLDER = '[non-text message]';
const CASE_SPLIT_IDLE_MS = 5 * 60 * 1000;
const MAX_CASES_IN_MEMORY = 200;
const CASE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

export const ONCALL_NOTIFICATION_STAGES = Object.freeze({
  NEW: 'new',
  HOLDING: 'holding',
  HIGHEST: 'highest',
  PROCESSING: 'processing',
  RESOLVED: 'resolved',
});

function normalizeNotificationStage(value) {
  return Object.values(ONCALL_NOTIFICATION_STAGES).includes(value) ? value : undefined;
}

function appendUnique(list, value) {
  if (!Array.isArray(list)) {
    return [value];
  }

  return list.includes(value) ? list : [...list, value];
}

function createCaseId(chatId, createdAt) {
  return `${chatId}:${createdAt}:${Math.random().toString(36).slice(2, 8)}`;
}

function getEventAt(payload, now) {
  return payload.createdAt || now;
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

function getReadableMessageText(text) {
  if (!text || text === NON_TEXT_PLACEHOLDER) {
    return '📎 非文本消息';
  }

  return text;
}

function createCaseRecord(payload, now) {
  const createdAt = getEventAt(payload, now);

  return {
    id: createCaseId(payload.chatId, createdAt),
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
    createdAt,
    updatedAt: createdAt,
    lastCustomerMessageAt: createdAt,
    latestCustomerMessageAt: createdAt,
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
    notificationRefs: [],
  };
}

function updateCustomerMessageSnapshot(caseRecord, payload, eventAt, config) {
  caseRecord.chatTitle = payload.chatTitle || caseRecord.chatTitle;
  caseRecord.senderId = payload.senderId || caseRecord.senderId;
  caseRecord.senderName = payload.senderName || caseRecord.senderName;
  caseRecord.messageIds = appendUnique(caseRecord.messageIds, payload.messageId);
  caseRecord.firstMessageId = caseRecord.firstMessageId || payload.messageId;
  caseRecord.lastMessageId = payload.messageId;
  caseRecord.updatedAt = eventAt;
  caseRecord.summary = getNormalizedText(payload.text, payload.previewText);
  caseRecord.lastCustomerText = getNormalizedText(payload.text, payload.previewText);
  caseRecord.latestCustomerMessageAt = eventAt;
  caseRecord.oncallConfig = config;
}

function resetEscalationTracking(caseRecord) {
  caseRecord.lastHoldingReplyAt = undefined;
  caseRecord.lastHoldingReplyText = undefined;
  caseRecord.lastAlertAt = undefined;
  caseRecord.highestAlertSentAt = undefined;
  caseRecord.escalationLevel = 0;
  caseRecord.priority = 'normal';
}

function refreshCaseDeadline(caseRecord, config) {
  caseRecord.nextEscalateAt = computeNextEscalateAt(caseRecord, config);
  caseRecord.deadlineVersion += 1;
}

function moveCaseIntoResolved(caseRecord, eventAt) {
  caseRecord.status = 'resolved';
  caseRecord.ackedAt = caseRecord.ackedAt || eventAt;
  caseRecord.resolvedAt = eventAt;
}

function restartCaseLifecycle(caseRecord, eventAt) {
  caseRecord.lastCustomerMessageAt = eventAt;
  caseRecord.latestCustomerMessageAt = eventAt;
  caseRecord.ownerUserId = undefined;
  caseRecord.ackedAt = undefined;
  caseRecord.processingAt = undefined;
  caseRecord.resolvedAt = undefined;
  caseRecord.lastStaffReplyAt = undefined;
  caseRecord.lastStaffReplyText = undefined;
  caseRecord.lastEffectiveResponderId = undefined;
  resetEscalationTracking(caseRecord);

  if (caseRecord.status === 'resolved' || caseRecord.status === 'expired') {
    caseRecord.status = 'reopened';
    caseRecord.reopenedAt = eventAt;
    return;
  }

  caseRecord.status = 'new';
}

function advanceProcessingConversation(caseRecord, eventAt, config) {
  caseRecord.lastCustomerMessageAt = eventAt;
  caseRecord.latestCustomerMessageAt = eventAt;
  caseRecord.lastHoldingReplyAt = undefined;
  caseRecord.lastHoldingReplyText = undefined;
  caseRecord.lastAlertAt = undefined;
  caseRecord.highestAlertSentAt = undefined;
  caseRecord.escalationLevel = 0;
  caseRecord.priority = 'normal';
  refreshCaseDeadline(caseRecord, config);
}

function advanceHoldingConversation(caseRecord, eventAt, config) {
  caseRecord.lastCustomerMessageAt = eventAt;
  caseRecord.latestCustomerMessageAt = eventAt;
  caseRecord.status = 'acked';
  refreshCaseDeadline(caseRecord, config);
}

export function createEmptyOncallState() {
  return {
    casesById: {},
    caseIdByChatId: {},
  };
}

export function getLatestCustomerMessageAt(caseRecord) {
  return caseRecord.latestCustomerMessageAt || caseRecord.lastCustomerMessageAt;
}

export function hasEffectiveReply(caseRecord) {
  const latestCustomerMessageAt = getLatestCustomerMessageAt(caseRecord);
  return Boolean(
    caseRecord.lastStaffReplyAt
    && latestCustomerMessageAt
    && caseRecord.lastStaffReplyAt >= latestCustomerMessageAt,
  );
}

export function hasHoldingReply(caseRecord) {
  return Boolean(
    caseRecord.lastHoldingReplyAt
    && (
      !caseRecord.lastStaffReplyAt
      || caseRecord.lastHoldingReplyAt >= caseRecord.lastStaffReplyAt
    )
    && !hasEffectiveReply(caseRecord)
  );
}

export function computeNextEscalateAt(caseRecord, config) {
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

    const holdingGraceAnchor = Math.max(
      caseRecord.lastHoldingReplyAt || 0,
      caseRecord.lastCustomerMessageAt || 0,
    );

    return holdingGraceAnchor + config.holdingReplyGraceTimeoutMs;
  }

  if (caseRecord.escalationLevel <= 0) {
    return caseRecord.lastCustomerMessageAt + config.firstResponseTimeoutMs;
  }

  if (caseRecord.escalationLevel === 1) {
    return caseRecord.lastCustomerMessageAt + config.highestEscalationTimeoutMs;
  }

  return undefined;
}

export function getNotificationStage(caseRecord) {
  if (caseRecord.status === 'expired') {
    return undefined;
  }

  if (caseRecord.status === 'resolved') {
    return ONCALL_NOTIFICATION_STAGES.RESOLVED;
  }

  if (caseRecord.status === 'processing') {
    if (!hasEffectiveReply(caseRecord) && caseRecord.escalationLevel >= 2) {
      return ONCALL_NOTIFICATION_STAGES.HIGHEST;
    }

    return ONCALL_NOTIFICATION_STAGES.PROCESSING;
  }

  if (hasEffectiveReply(caseRecord)) {
    return undefined;
  }

  if (caseRecord.escalationLevel >= 2) {
    return ONCALL_NOTIFICATION_STAGES.HIGHEST;
  }

  if (hasHoldingReply(caseRecord)) {
    return ONCALL_NOTIFICATION_STAGES.HOLDING;
  }

  return ONCALL_NOTIFICATION_STAGES.NEW;
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

export function getStageTarget(config, stage) {
  if (stage === ONCALL_NOTIFICATION_STAGES.NEW) {
    return buildStageTarget(config.newAlertChatId, config.newAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.HOLDING) {
    return buildStageTarget(config.holdingAlertChatId, config.holdingAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.HIGHEST) {
    return buildStageTarget(config.highestAlertChatId, config.highestAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.PROCESSING) {
    return buildStageTarget(config.processingAlertChatId, config.processingAlertThreadId);
  }

  if (stage === ONCALL_NOTIFICATION_STAGES.RESOLVED) {
    return buildStageTarget(config.resolvedAlertChatId, config.resolvedAlertThreadId);
  }

  return undefined;
}

export function normalizeNotificationRef(ref) {
  if (!ref || typeof ref !== 'object') {
    return undefined;
  }

  const stage = normalizeNotificationStage(ref.stage);
  const chatId = typeof ref.chatId === 'string' ? ref.chatId.trim() : '';
  const threadId = typeof ref.threadId === 'string' ? ref.threadId.trim() : '';
  const messageId = Number(ref.messageId);

  if (!stage || !chatId || !Number.isFinite(messageId) || messageId <= 0) {
    return undefined;
  }

  return {
    stage,
    chatId,
    threadId: threadId || '',
    messageId,
  };
}

export function areNotificationRefsEqual(left, right) {
  return Boolean(
    left
    && right
    && left.stage === right.stage
    && left.chatId === right.chatId
    && (left.threadId || '') === (right.threadId || '')
    && Number(left.messageId) === Number(right.messageId),
  );
}

export function mergeNotificationRefs(refs, nextRef) {
  const normalizedExisting = Array.isArray(refs)
    ? refs.map(normalizeNotificationRef).filter(Boolean)
    : [];

  if (!nextRef) {
    return normalizedExisting;
  }

  if (normalizedExisting.some((ref) => areNotificationRefsEqual(ref, nextRef))) {
    return normalizedExisting;
  }

  return [...normalizedExisting, nextRef];
}

export function getActiveNotificationRef(caseRecord) {
  return normalizeNotificationRef({
    stage: caseRecord.notificationStage,
    chatId: caseRecord.notificationChatId,
    threadId: caseRecord.notificationThreadId,
    messageId: caseRecord.notificationMessageId,
  });
}

export function getCaseNotificationRefs(caseRecord) {
  const refs = mergeNotificationRefs(caseRecord.notificationRefs, getActiveNotificationRef(caseRecord));
  const activeRef = getActiveNotificationRef(caseRecord);

  if (!activeRef) {
    return refs;
  }

  return mergeNotificationRefs(refs, activeRef);
}

export function buildNotificationRef(stage, target, messageId) {
  return normalizeNotificationRef({
    stage,
    chatId: target?.chatId,
    threadId: target?.threadId,
    messageId,
  });
}

function buildChatLink(chatId) {
  const normalizedChatId = typeof chatId === 'string' ? chatId.trim() : '';
  if (!normalizedChatId || !normalizedChatId.startsWith('-100')) {
    return undefined;
  }

  const rawChannelId = normalizedChatId.slice(4);

  if (!rawChannelId || !/^\d+$/.test(rawChannelId)) {
    return undefined;
  }

  return `https://t.me/c/${rawChannelId}`;
}

function buildMessageLink(chatId, messageId) {
  const chatLink = buildChatLink(chatId);
  if (!chatLink || !messageId) {
    return undefined;
  }

  const normalizedMessageId = Number(messageId);
  if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) {
    return undefined;
  }

  return `${chatLink}/${normalizedMessageId}`;
}

export function buildNotificationMessage(caseRecord, stage) {
  const stageTitles = {
    [ONCALL_NOTIFICATION_STAGES.NEW]: '🆕 新消息待处理',
    [ONCALL_NOTIFICATION_STAGES.HOLDING]: '⏳ 已回复稍等，等待用户补充',
    [ONCALL_NOTIFICATION_STAGES.HIGHEST]: '🚨 超时未处理',
    [ONCALL_NOTIFICATION_STAGES.PROCESSING]: '🛠️ 跟进处理中',
    [ONCALL_NOTIFICATION_STAGES.RESOLVED]: '✅ 已处理完成',
  };

  const latestCustomerMessage = getReadableMessageText(caseRecord.lastCustomerText);
  const lastStaffReply = caseRecord.lastStaffReplyText
    ? getReadableMessageText(caseRecord.lastStaffReplyText)
    : (caseRecord.lastHoldingReplyText ? getReadableMessageText(caseRecord.lastHoldingReplyText) : undefined);

  const lines = [
    stageTitles[stage] || '📨 Oncall 消息',
  ];

  if (caseRecord.chatTitle) {
    lines.push(caseRecord.chatTitle);
  }

  lines.push(`Chat ID: ${caseRecord.chatId}`);

  const latestMessageLink = buildMessageLink(
    caseRecord.chatId,
    caseRecord.firstMessageId || caseRecord.lastMessageId,
  );
  const chatLink = buildChatLink(caseRecord.chatId);
  if (latestMessageLink) {
    lines.push(`消息链接: ${latestMessageLink}`);
  } else if (chatLink) {
    lines.push(`群链接: ${chatLink}`);
  }

  if (latestMessageLink && chatLink) {
    lines.push(`群链接: ${chatLink}`);
  }
  lines.push('');
  lines.push(`用户: ${latestCustomerMessage}`);

  if (lastStaffReply) {
    lines.push(`客服: ${lastStaffReply}`);
  }

  return lines.join('\n');
}

export function classifyStaffReply(text, config) {
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

export function isCustomerResolveReply(text, config) {
  const normalizedText = (text || '').trim();
  if (!normalizedText) {
    return false;
  }

  return config.customerResolvePatterns.some((pattern) => pattern.test(normalizedText));
}

export function ensureCaseForChat(state, payload, now) {
  const existingCaseId = state.caseIdByChatId[payload.chatId];
  const existingCase = existingCaseId ? state.casesById[existingCaseId] : undefined;

  if (existingCase) {
    return existingCase;
  }

  const nextCase = createCaseRecord(payload, now);
  state.caseIdByChatId[payload.chatId] = nextCase.id;
  state.casesById[nextCase.id] = nextCase;

  return nextCase;
}

export function getLastCaseInteractionAt(caseRecord) {
  return [
    caseRecord.reopenedAt,
    caseRecord.resolvedAt,
    caseRecord.processingAt,
    caseRecord.ackedAt,
    caseRecord.lastStaffReplyAt,
    caseRecord.lastHoldingReplyAt,
    caseRecord.latestCustomerMessageAt,
    caseRecord.lastCustomerMessageAt,
    caseRecord.createdAt,
  ].reduce((latest, value) => (typeof value === 'number' && value > latest ? value : latest), 0);
}

function shouldEvictCaseByRetention(caseRecord, now) {
  const lastInteractionAt = getLastCaseInteractionAt(caseRecord);
  if (!lastInteractionAt) {
    return false;
  }

  return now - lastInteractionAt >= CASE_RETENTION_MS;
}

export function compactOncallState(state, now) {
  const cases = Object.values(state.casesById || {});
  const evictedCases = [];
  const evictedCaseIds = new Set();

  const evictCase = (caseRecord) => {
    if (!caseRecord?.id || evictedCaseIds.has(caseRecord.id)) {
      return;
    }

    evictedCaseIds.add(caseRecord.id);
    evictedCases.push(JSON.parse(JSON.stringify(caseRecord)));
    delete state.casesById[caseRecord.id];

    if (state.caseIdByChatId[caseRecord.chatId] === caseRecord.id) {
      delete state.caseIdByChatId[caseRecord.chatId];
    }
  };

  for (const caseRecord of cases) {
    if (shouldEvictCaseByRetention(caseRecord, now)) {
      evictCase(caseRecord);
    }
  }

  const remainingCases = Object.values(state.casesById || {});
  if (remainingCases.length > MAX_CASES_IN_MEMORY) {
    const overflowCount = remainingCases.length - MAX_CASES_IN_MEMORY;
    const overflowVictims = remainingCases
      .sort((left, right) => getLastCaseInteractionAt(left) - getLastCaseInteractionAt(right))
      .slice(0, overflowCount);

    for (const caseRecord of overflowVictims) {
      evictCase(caseRecord);
    }
  }

  return {
    evictedCases,
    totalCases: Object.keys(state.casesById || {}).length,
  };
}

function shouldStartNewCase(existingCase, eventAt) {
  if (!existingCase) {
    return false;
  }

  const lastInteractionAt = getLastCaseInteractionAt(existingCase);
  return Boolean(lastInteractionAt && eventAt - lastInteractionAt >= CASE_SPLIT_IDLE_MS);
}

function rotateChatCase(state, payload, now) {
  const eventAt = getEventAt(payload, now);
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

export function applyUsefulMessageEvent(state, payload, config, now) {
  const staleCaseRecord = rotateChatCase(state, payload, now);
  const caseRecord = ensureCaseForChat(state, payload, now);

  if (caseRecord.messageIds.includes(payload.messageId)) {
    return {
      caseRecord,
      changed: false,
    };
  }

  const eventAt = getEventAt(payload, now);
  const latestCustomerMessageAt = getLatestCustomerMessageAt(caseRecord);
  const hadEffectiveReplyForCurrentTurn = Boolean(
    caseRecord.lastStaffReplyAt
    && latestCustomerMessageAt
    && caseRecord.lastStaffReplyAt >= latestCustomerMessageAt
  );
  const hadHoldingReplyForCurrentTurn = Boolean(
    caseRecord.lastHoldingReplyAt
    && latestCustomerMessageAt
    && caseRecord.lastHoldingReplyAt >= latestCustomerMessageAt
    && !hadEffectiveReplyForCurrentTurn
  );

  updateCustomerMessageSnapshot(caseRecord, payload, eventAt, config);

  const shouldResolveByCustomerReply = (
    caseRecord.status !== 'resolved'
    && caseRecord.status !== 'expired'
    && (hadEffectiveReplyForCurrentTurn || hadHoldingReplyForCurrentTurn)
    && isCustomerResolveReply(caseRecord.lastCustomerText, config)
  );

  if (shouldResolveByCustomerReply) {
    moveCaseIntoResolved(caseRecord, eventAt);
    refreshCaseDeadline(caseRecord, config);

    return {
      caseRecord,
      staleCaseRecord,
      changed: true,
      classifiedKind: 'customer_resolve_reply',
    };
  }

  const shouldPreserveProcessingStage = (
    caseRecord.status === 'processing'
    && hadEffectiveReplyForCurrentTurn
  );

  if (shouldPreserveProcessingStage) {
    advanceProcessingConversation(caseRecord, eventAt, config);

    return {
      caseRecord,
      staleCaseRecord,
      changed: true,
      classifiedKind: 'processing_follow_up',
    };
  }

  const shouldPreserveHoldingStage = (
    caseRecord.status === 'acked'
    && hadHoldingReplyForCurrentTurn
  );

  if (shouldPreserveHoldingStage) {
    advanceHoldingConversation(caseRecord, eventAt, config);

    return {
      caseRecord,
      staleCaseRecord,
      changed: true,
      classifiedKind: 'holding_follow_up',
    };
  }

  const shouldRestartLifecycle = (
    caseRecord.messageIds.length <= 1
    || caseRecord.status === 'resolved'
    || caseRecord.status === 'expired'
    || hadEffectiveReplyForCurrentTurn
  );

  if (!shouldRestartLifecycle) {
    return {
      caseRecord,
      staleCaseRecord,
      changed: true,
    };
  }

  restartCaseLifecycle(caseRecord, eventAt);
  refreshCaseDeadline(caseRecord, config);

  return {
    caseRecord,
    staleCaseRecord,
    changed: true,
  };
}

export function applyStaffReplyEvent(state, payload, config, now) {
  const replyTargetCase = findCaseByMessageId(state, payload.chatId, payload.replyToMessageId);
  const fallbackCaseId = state.caseIdByChatId[payload.chatId];
  const caseRecord = replyTargetCase || (fallbackCaseId ? state.casesById[fallbackCaseId] : undefined);

  if (!caseRecord) {
    return {
      changed: false,
      reason: 'case_not_found',
    };
  }

  if (caseRecord.staffMessageIds.includes(payload.messageId)) {
    return {
      caseRecord,
      changed: false,
      reason: 'duplicate_staff_message',
      matchedBy: replyTargetCase ? 'reply_target' : 'active_chat_case',
    };
  }

  const createdAt = getEventAt(payload, now);
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
    caseRecord.lastAlertAt = undefined;
    caseRecord.highestAlertSentAt = undefined;
    caseRecord.escalationLevel = 0;
    caseRecord.priority = 'normal';
  } else if (kind === 'resolve_reply') {
    caseRecord.status = 'resolved';
    caseRecord.ackedAt = caseRecord.ackedAt || createdAt;
    caseRecord.lastStaffReplyAt = createdAt;
    caseRecord.lastStaffReplyText = getNormalizedText(payload.text, payload.previewText);
    caseRecord.resolvedAt = createdAt;
  } else {
    caseRecord.status = 'processing';
    caseRecord.ackedAt = caseRecord.ackedAt || createdAt;
    caseRecord.processingAt = createdAt;
    caseRecord.lastStaffReplyAt = createdAt;
    caseRecord.lastStaffReplyText = getNormalizedText(payload.text, payload.previewText);
  }

  refreshCaseDeadline(caseRecord, config);

  return {
    caseRecord,
    changed: true,
    classifiedKind: kind,
    matchedBy: replyTargetCase ? 'reply_target' : 'active_chat_case',
  };
}

export function applyDeadlineEvent(state, payload, now) {
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

export function applyCaseStatusEvent(state, payload, now) {
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
  const updatedAt = getEventAt(payload, now);
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
