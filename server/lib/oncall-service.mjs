import {
  applyCaseStatusEvent,
  applyDeadlineEvent,
  applyStaffReplyEvent,
  applyUsefulMessageEvent,
  areNotificationRefsEqual,
  buildNotificationMessage,
  buildNotificationRef,
  compactOncallState,
  getActiveNotificationRef,
  getCaseNotificationRefs,
  getNotificationStage,
  getStageTarget,
  mergeNotificationRefs,
  normalizeNotificationRef,
  sanitizeOncallCaseForResponse,
} from './oncall-case-state.mjs';
import { getDefaultOncallConfig, normalizeOncallConfig } from './oncall-config.mjs';
import { OncallStore } from './oncall-store.mjs';
import { TelegramBotClient } from './telegram-bot.mjs';

export { sanitizeOncallCaseForResponse } from './oncall-case-state.mjs';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function getNow() {
  return Date.now();
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export class OncallService {
  constructor({ log }) {
    this.log = log;
    this.store = new OncallStore(undefined, log);
    this.botClient = new TelegramBotClient(log);
    this.timersByCaseId = new Map();
    this.notificationSyncsByCaseId = new Map();
    this.defaultConfig = getDefaultOncallConfig();
  }

  async init() {
    await this.store.init();
  }

  async compactMemory(reason) {
    const result = await this.store.mutate((state) => compactOncallState(state, getNow()));
    if (!result?.evictedCases?.length) {
      return;
    }

    for (const caseRecord of result.evictedCases) {
      this.clearCaseSchedule(caseRecord.id);
      this.notificationSyncsByCaseId.delete(caseRecord.id);
      void this.cleanupCaseNotifications(caseRecord).catch(() => undefined);
    }

    this.log('Oncall memory compacted', {
      reason,
      evictedCaseCount: result.evictedCases.length,
      evictedCaseIds: result.evictedCases.map((caseRecord) => caseRecord.id),
      remainingCaseCount: result.totalCases,
    });
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
        classifiedKind: result.classifiedKind,
      });
      if (result.staleCaseRecord) {
        this.syncCaseSchedule(result.staleCaseRecord);
        await this.syncCaseNotification(result.staleCaseRecord);
      }
      this.syncCaseSchedule(result.caseRecord);
      await this.syncCaseNotification(result.caseRecord);
    }

    await this.compactMemory('ingest_useful_message');

    return result;
  }

  async reportStaffReply(payload) {
    const config = normalizeOncallConfig(payload.oncallConfig, this.defaultConfig);
    const now = getNow();
    const result = await this.store.mutate((state) => (
      applyStaffReplyEvent(state, payload, config, now)
    ));

    this.log('Oncall staff reply reported', {
      chatId: payload.chatId,
      messageId: payload.messageId,
      replyToMessageId: payload.replyToMessageId,
      staffUserId: payload.staffUserId,
      text: payload.text,
      caseId: result.caseRecord?.id,
      status: result.caseRecord?.status,
      nextEscalateAt: result.caseRecord?.nextEscalateAt,
      escalationLevel: result.caseRecord?.escalationLevel,
      classifiedKind: result.classifiedKind,
      matchedBy: result.matchedBy,
      reason: result.reason,
      notificationStage: result.caseRecord ? getNotificationStage(result.caseRecord) : undefined,
    });

    if (result.caseRecord) {
      this.syncCaseSchedule(result.caseRecord);
      await this.syncCaseNotification(result.caseRecord);
    }

    await this.compactMemory('report_staff_reply');

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

    await this.compactMemory('deadline_reached');
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

    await this.compactMemory('update_case_status');

    return result;
  }

  async setCaseNotification(caseId, nextState, notificationRefs) {
    await this.store.mutate((state) => {
      const caseRecord = state.casesById[caseId];
      if (!caseRecord) {
        return undefined;
      }

      caseRecord.notificationStage = nextState?.stage;
      caseRecord.notificationChatId = nextState?.chatId;
      caseRecord.notificationThreadId = nextState?.threadId;
      caseRecord.notificationMessageId = nextState?.messageId;
      caseRecord.notificationRefs = Array.isArray(notificationRefs)
        ? notificationRefs.map(normalizeNotificationRef).filter(Boolean)
        : [];
      return undefined;
    });
  }

  async cleanupCaseNotifications(caseRecord, keepRef) {
    const config = caseRecord.oncallConfig || this.defaultConfig;
    const refs = getCaseNotificationRefs(caseRecord);
    const remainingRefs = [];

    for (const ref of refs) {
      if (keepRef && areNotificationRefsEqual(ref, keepRef)) {
        remainingRefs.push(ref);
        continue;
      }

      const deleteResult = await this.botClient.deleteMessage({
        telegramBotToken: config.telegramBotToken,
        telegramAlertChatId: ref.chatId,
        telegramAlertThreadId: ref.threadId,
      }, ref.messageId);

      if (!deleteResult?.ok) {
        remainingRefs.push(ref);
      }
    }

    return remainingRefs;
  }

  async syncCaseNotification(caseRecord) {
    const caseId = caseRecord?.id;
    if (!caseId) {
      return;
    }

    const previousSync = this.notificationSyncsByCaseId.get(caseId) || Promise.resolve();
    const nextSync = previousSync
      .catch(() => undefined)
      .then(async () => {
        await this.syncCaseNotificationNow(caseId);
      });

    this.notificationSyncsByCaseId.set(caseId, nextSync);

    try {
      await nextSync;
    } finally {
      if (this.notificationSyncsByCaseId.get(caseId) === nextSync) {
        this.notificationSyncsByCaseId.delete(caseId);
      }
    }
  }

  async syncCaseNotificationNow(caseId) {
    const caseRecord = await this.store.read((state) => state.casesById[caseId]);
    if (!caseRecord) {
      this.log('Oncall notification sync skipped: case missing', { caseId });
      return;
    }

    const config = caseRecord.oncallConfig || this.defaultConfig;
    const nextStage = getNotificationStage(caseRecord);
    const nextTarget = nextStage ? getStageTarget(config, nextStage) : undefined;
    const activeRef = getActiveNotificationRef(caseRecord);
    const sameStage = nextStage === caseRecord.notificationStage;
    const sameChat = (nextTarget?.chatId || '') === (caseRecord.notificationChatId || '');
    const sameThread = (nextTarget?.threadId || '') === (caseRecord.notificationThreadId || '');

    if (!nextStage || !nextTarget?.chatId) {
      const remainingRefs = await this.cleanupCaseNotifications(caseRecord);
      if (caseRecord.notificationMessageId || caseRecord.notificationChatId || remainingRefs.length) {
        await this.setCaseNotification(caseRecord.id, undefined, remainingRefs);
      }
      return;
    }

    if (sameStage && sameChat && sameThread && caseRecord.notificationMessageId) {
      const updateResult = await this.botClient.updateAlert(
        {
          telegramBotToken: config.telegramBotToken,
          telegramAlertChatId: caseRecord.notificationChatId,
          telegramAlertThreadId: caseRecord.notificationThreadId,
        },
        caseRecord.notificationMessageId,
        buildNotificationMessage(caseRecord, nextStage),
      );

      if (updateResult?.ok) {
        const remainingRefs = await this.cleanupCaseNotifications(caseRecord, activeRef);
        await this.setCaseNotification(caseRecord.id, activeRef, remainingRefs);
        return;
      }
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

    const nextRef = buildNotificationRef(nextStage, nextTarget, sendResult.messageId);
    const refsWithNext = mergeNotificationRefs(getCaseNotificationRefs(caseRecord), nextRef);
    const remainingRefs = await this.cleanupCaseNotifications({
      ...caseRecord,
      notificationRefs: refsWithNext,
    }, nextRef);

    await this.setCaseNotification(caseRecord.id, {
      stage: nextStage,
      chatId: nextTarget.chatId,
      threadId: nextTarget.threadId || '',
      messageId: sendResult.messageId,
    }, remainingRefs);
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

      void this.handleDeadlineReached(caseId, deadlineVersion).catch((error) => {
        this.log('Oncall deadline handler failed', {
          caseId,
          deadlineVersion,
          error: getErrorMessage(error),
        });
      });
    }, effectiveDelay);

    this.timersByCaseId.set(caseId, { timeoutId, deadlineVersion, targetAt });
  }

  async close() {
    for (const caseId of this.timersByCaseId.keys()) {
      this.clearCaseSchedule(caseId);
    }

    await Promise.allSettled(this.notificationSyncsByCaseId.values());
    this.notificationSyncsByCaseId.clear();
  }
}

export async function createOncallService(log) {
  const service = new OncallService({
    log,
  });

  await service.init();
  return service;
}
