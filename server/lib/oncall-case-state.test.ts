/// <reference types="jest" />
// @ts-nocheck

import {
  applyCaseStatusEvent,
  applyDeadlineEvent,
  applyStaffReplyEvent,
  applyUsefulMessageEvent,
  buildNotificationMessage,
  createEmptyOncallState,
  getNotificationStage,
} from './oncall-case-state.mjs';
import { normalizeOncallConfig } from './oncall-config.mjs';

function createConfig(overrides = {}) {
  return normalizeOncallConfig({
    enabled: true,
    ...overrides,
  });
}

function getSingleCase(state) {
  const cases = Object.values(state.casesById);
  expect(cases).toHaveLength(1);
  return cases[0];
}

describe('oncall-case-state', () => {
  it('creates a new case and schedules first response escalation', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      firstResponseTimeoutMs: 1_000,
    });

    const result = applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 5_000,
      text: 'Need help',
    }, config, 5_000);

    expect(result.changed).toBe(true);
    expect(result.caseRecord.status).toBe('new');
    expect(result.caseRecord.messageIds).toEqual([101]);
    expect(result.caseRecord.lastCustomerText).toBe('Need help');
    expect(result.caseRecord.nextEscalateAt).toBe(6_000);
    expect(result.caseRecord.deadlineVersion).toBe(1);
    expect(state.caseIdByChatId['chat-1']).toBe(result.caseRecord.id);
  });

  it('resolves a case when customer confirms after a holding reply', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      holdingReplyGraceTimeoutMs: 2_000,
    });

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    const replyResult = applyStaffReplyEvent(state, {
      chatId: 'chat-1',
      messageId: 201,
      replyToMessageId: 101,
      createdAt: 2_000,
      text: '稍等，我看一下',
      staffUserId: 'staff-1',
    }, config, 2_000);

    expect(replyResult.caseRecord.status).toBe('acked');
    expect(replyResult.caseRecord.lastHoldingReplyAt).toBe(2_000);
    expect(replyResult.caseRecord.nextEscalateAt).toBe(4_000);

    const customerResult = applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 102,
      createdAt: 2_500,
      text: '好的',
    }, config, 2_500);

    expect(customerResult.classifiedKind).toBe('customer_resolve_reply');
    expect(customerResult.caseRecord.status).toBe('resolved');
    expect(customerResult.caseRecord.ackedAt).toBe(2_000);
    expect(customerResult.caseRecord.resolvedAt).toBe(2_500);
    expect(customerResult.caseRecord.nextEscalateAt).toBeUndefined();
  });

  it('keeps a holding case in waiting when the customer follows up and refreshes the grace deadline', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      holdingReplyGraceTimeoutMs: 2_000,
    });

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    applyStaffReplyEvent(state, {
      chatId: 'chat-1',
      messageId: 201,
      replyToMessageId: 101,
      createdAt: 2_000,
      text: '稍等，我看一下',
      staffUserId: 'staff-1',
    }, config, 2_000);

    const result = applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 102,
      createdAt: 3_000,
      text: '还有个问题',
    }, config, 3_000);

    expect(result.classifiedKind).toBe('holding_follow_up');
    expect(result.caseRecord.status).toBe('acked');
    expect(result.caseRecord.lastHoldingReplyAt).toBe(2_000);
    expect(result.caseRecord.lastCustomerMessageAt).toBe(3_000);
    expect(result.caseRecord.nextEscalateAt).toBe(5_000);
    expect(getNotificationStage(result.caseRecord)).toBe('holding');
  });

  it('keeps processing state for follow-up after an effective reply and restarts escalation from the new customer'
    + ' turn', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      firstResponseTimeoutMs: 1_000,
    });

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    applyStaffReplyEvent(state, {
      chatId: 'chat-1',
      messageId: 201,
      replyToMessageId: 101,
      createdAt: 2_000,
      text: 'Handled',
      staffUserId: 'staff-1',
    }, config, 2_000);

    const caseRecord = getSingleCase(state);
    caseRecord.escalationLevel = 2;
    caseRecord.priority = 'urgent';
    caseRecord.lastHoldingReplyAt = 1_900;
    caseRecord.lastHoldingReplyText = '稍等';
    caseRecord.lastAlertAt = 1_950;
    caseRecord.highestAlertSentAt = 1_960;

    const result = applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 102,
      createdAt: 3_000,
      text: 'Still not fixed',
    }, config, 3_000);

    expect(result.classifiedKind).toBe('processing_follow_up');
    expect(result.caseRecord.status).toBe('processing');
    expect(result.caseRecord.processingAt).toBe(2_000);
    expect(result.caseRecord.lastStaffReplyAt).toBe(2_000);
    expect(result.caseRecord.escalationLevel).toBe(0);
    expect(result.caseRecord.priority).toBe('normal');
    expect(result.caseRecord.lastHoldingReplyAt).toBeUndefined();
    expect(result.caseRecord.highestAlertSentAt).toBeUndefined();
    expect(result.caseRecord.nextEscalateAt).toBe(4_000);
  });

  it('escalates deadlines step by step and ignores stale deadline versions', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      firstResponseTimeoutMs: 1_000,
      highestEscalationTimeoutMs: 2_000,
      reminderCooldownMs: 500,
    });

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    const caseRecord = getSingleCase(state);
    const firstDeadlineVersion = caseRecord.deadlineVersion;

    const firstEscalation = applyDeadlineEvent(state, {
      caseId: caseRecord.id,
      deadlineVersion: firstDeadlineVersion,
    }, 2_000);

    expect(firstEscalation.changed).toBe(true);
    expect(firstEscalation.caseRecord.escalationLevel).toBe(1);
    expect(firstEscalation.caseRecord.priority).toBe('high');
    expect(firstEscalation.caseRecord.nextEscalateAt).toBe(3_000);

    const stale = applyDeadlineEvent(state, {
      caseId: caseRecord.id,
      deadlineVersion: firstDeadlineVersion,
    }, 3_000);

    expect(stale.changed).toBe(false);

    const secondDeadlineVersion = firstEscalation.caseRecord.deadlineVersion;
    const secondEscalation = applyDeadlineEvent(state, {
      caseId: caseRecord.id,
      deadlineVersion: secondDeadlineVersion,
    }, 3_000);

    expect(secondEscalation.changed).toBe(true);
    expect(secondEscalation.caseRecord.escalationLevel).toBe(2);
    expect(secondEscalation.caseRecord.priority).toBe('urgent');
    expect(secondEscalation.caseRecord.highestAlertSentAt).toBe(3_000);
  });

  it('moves a highest escalation case into waiting when staff replies with holding text', () => {
    const state = createEmptyOncallState();
    const config = createConfig({
      firstResponseTimeoutMs: 1_000,
      highestEscalationTimeoutMs: 1_000,
      holdingReplyGraceTimeoutMs: 2_000,
    });

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    let caseRecord = getSingleCase(state);
    applyDeadlineEvent(state, {
      caseId: caseRecord.id,
      deadlineVersion: caseRecord.deadlineVersion,
    }, 2_000);

    caseRecord = getSingleCase(state);
    applyDeadlineEvent(state, {
      caseId: caseRecord.id,
      deadlineVersion: caseRecord.deadlineVersion,
    }, 3_000);

    caseRecord = getSingleCase(state);
    expect(caseRecord.escalationLevel).toBe(2);
    expect(getNotificationStage(caseRecord)).toBe('highest');

    const result = applyStaffReplyEvent(state, {
      chatId: 'chat-1',
      messageId: 201,
      replyToMessageId: 101,
      createdAt: 3_500,
      text: '稍等，我看一下',
      staffUserId: 'staff-1',
    }, config, 3_500);

    expect(result.classifiedKind).toBe('holding_reply');
    expect(result.caseRecord.status).toBe('acked');
    expect(result.caseRecord.escalationLevel).toBe(0);
    expect(result.caseRecord.priority).toBe('normal');
    expect(result.caseRecord.nextEscalateAt).toBe(5_500);
    expect(getNotificationStage(result.caseRecord)).toBe('holding');
  });

  it('blocks manual status updates for inactive cases', () => {
    const state = createEmptyOncallState();
    const config = createConfig();

    applyUsefulMessageEvent(state, {
      chatId: 'chat-1',
      messageId: 101,
      createdAt: 1_000,
      text: 'Need help',
    }, config, 1_000);

    const caseRecord = getSingleCase(state);
    applyCaseStatusEvent(state, {
      caseId: caseRecord.id,
      status: 'resolved',
      userId: 'staff-1',
      createdAt: 2_000,
    }, 2_000);

    const result = applyCaseStatusEvent(state, {
      caseId: caseRecord.id,
      status: 'processing',
      userId: 'staff-2',
      createdAt: 3_000,
    }, 3_000);

    expect(result.changed).toBe(false);
    expect(result.error).toBe('case_not_active');
    expect(result.caseRecord.status).toBe('resolved');
  });

  it('includes both message and chat links for supported private channel style chats', () => {
    const message = buildNotificationMessage({
      id: 'case-1',
      chatId: '-1001234567890',
      chatTitle: 'Ops Group',
      firstMessageId: 42,
      lastMessageId: 42,
      status: 'new',
      priority: 'normal',
      escalationLevel: 0,
      lastCustomerText: 'Need help',
    }, 'new');

    expect(message).toContain('🆕 新消息待处理');
    expect(message).toContain('Ops Group');
    expect(message).toContain('Chat ID: -1001234567890');
    expect(message).toContain('消息链接: https://t.me/c/1234567890/42');
    expect(message).toContain('群链接: https://t.me/c/1234567890');
    expect(message).toContain('用户: Need help');
  });

  it('omits Telegram links for chats that do not support private channel style links', () => {
    const message = buildNotificationMessage({
      id: 'case-1',
      chatId: '-987654321',
      chatTitle: 'Legacy Group',
      firstMessageId: 42,
      lastMessageId: 42,
      status: 'new',
      priority: 'normal',
      escalationLevel: 0,
      lastCustomerText: 'Need help',
    }, 'new');

    expect(message).not.toContain('消息链接:');
    expect(message).not.toContain('群链接:');
  });

  it('renders non-text content with a friendly placeholder', () => {
    const message = buildNotificationMessage({
      id: 'case-1',
      chatId: '-1001234567890',
      chatTitle: 'Ops Group',
      firstMessageId: 42,
      lastMessageId: 42,
      status: 'processing',
      priority: 'normal',
      escalationLevel: 0,
      lastCustomerText: '[non-text message]',
      lastStaffReplyText: '[non-text message]',
    }, 'processing');

    expect(message).toContain('用户: 📎 非文本消息');
    expect(message).toContain('客服: 📎 非文本消息');
  });
});
