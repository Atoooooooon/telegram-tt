import type { GlobalState } from '../../types';
import type { CustomerServiceSettings, CustomerServiceV2State } from '../../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import {
  normalizeCustomerServiceKnownChats,
  normalizeCustomerServiceOncallSettings,
  normalizeCustomerServiceQuickReplies,
} from '../../helpers/customerServiceV2Settings';
import { updateTabState } from '../../reducers/tabs';
import { selectChat } from '../../selectors';

export function ownersMatch(left?: string, right?: string): boolean {
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

export function ensureCustomerServiceV2State(state?: CustomerServiceV2State): CustomerServiceV2State {
  if (state) {
    return state;
  }

  return {
    messages: [],
    messagesByChatId: {},
    lastSyncTimestamp: Date.now(),
    messageCount: 0,
  };
}

export function logCustomerServiceCloudSyncDebug(...args: unknown[]) {
  if (typeof console === 'undefined') {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[CustomerServiceCloudSync]', ...args);
}

type CustomerServiceConfig = typeof CUSTOMER_SERVICE_CONFIG;

function normalizeRegexFilterEntry(filter: unknown) {
  if (filter instanceof RegExp) {
    return { source: filter.source, flags: filter.flags };
  }

  if (filter && typeof (filter as { source?: string; flags?: string }).source === 'string') {
    return {
      source: (filter as { source: string }).source,
      flags: typeof (filter as { flags?: string }).flags === 'string' ? (filter as { flags: string }).flags : '',
    };
  }

  if (typeof filter === 'string') {
    return { source: filter, flags: '' };
  }

  return { source: String(filter), flags: '' };
}

export function mapCustomerServiceConfigToSettings(
  config: CustomerServiceConfig = CUSTOMER_SERVICE_CONFIG,
): CustomerServiceSettings {
  return {
    monitoredChatIds: [...config.MONITORED_CHAT_IDS],
    filteredUserIds: [...config.FILTERED_USER_IDS],
    regexFilters: (config.REGEX_FILTERS || []).map(normalizeRegexFilterEntry),
    mode: 'oncall',
    autoRead: false,
    quickReplies: normalizeCustomerServiceQuickReplies(config.QUICK_REPLIES),
    quickReplyPanelGlobal: false,
    rules: undefined,
    oncall: normalizeCustomerServiceOncallSettings(config.ONCALL_DEFAULTS),
    knownChats: undefined,
  };
}

export function getDefaultCustomerServiceV2Settings(): CustomerServiceSettings {
  return mapCustomerServiceConfigToSettings();
}

export function syncCustomerServiceV2StateAcrossTabs(
  global: GlobalState,
  nextState: CustomerServiceV2State,
): GlobalState {
  const nextByTabId = { ...global.byTabId };

  Object.values(global.byTabId).forEach((tabState) => {
    nextByTabId[tabState.id] = {
      ...tabState,
      customerServiceV2: {
        ...nextState,
        currentContextChatId: tabState.customerServiceV2?.currentContextChatId,
        currentContextMessageId: tabState.customerServiceV2?.currentContextMessageId,
      },
    };
  });

  return {
    ...global,
    byTabId: nextByTabId,
  };
}

export function normalizeSettingsForSave(settings: CustomerServiceSettings): CustomerServiceSettings {
  return {
    monitoredChatIds: settings.monitoredChatIds || [],
    filteredUserIds: settings.filteredUserIds || [],
    regexFilters: (settings.regexFilters || []).map((filter) => ({
      source: filter.source,
      flags: filter.flags,
    })),
    mode: settings.mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(settings.autoRead),
    quickReplies: normalizeCustomerServiceQuickReplies(settings.quickReplies || []),
    quickReplyPanelGlobal: Boolean(settings.quickReplyPanelGlobal),
    rules: settings.rules,
    oncall: normalizeCustomerServiceOncallSettings(settings.oncall),
    knownChats: normalizeCustomerServiceKnownChats(settings.knownChats),
  };
}

type PauseOptions = {
  pausedAt?: number;
};

export function pauseCustomerServiceChat(
  global: GlobalState,
  chatId: string,
  messageId: number,
  options?: PauseOptions,
): GlobalState {
  if (!messageId) {
    return global;
  }

  let nextGlobal = global;
  const pausedAt = options?.pausedAt ?? Date.now();

  Object.values(nextGlobal.byTabId).forEach(({ id: tabId, customerServiceV2 }) => {
    if (!customerServiceV2 || customerServiceV2.settings?.mode !== 'assist') {
      return;
    }

    const previousEntry = customerServiceV2.pausedChats?.[chatId];
    if (previousEntry && previousEntry.lastMessageId >= messageId) {
      return;
    }

    const pausedChats = {
      ...(customerServiceV2.pausedChats || {}),
      [chatId]: {
        pausedAt,
        lastMessageId: messageId,
      },
    };

    nextGlobal = updateTabState(nextGlobal, {
      customerServiceV2: {
        ...customerServiceV2,
        pausedChats,
      },
    }, tabId);
  });

  return nextGlobal;
}

type ResumePausedOptions = {
  lastReadInboxMessageId?: number;
  hasUnread?: boolean;
};

export function resumeCustomerServicePausedChat(
  global: GlobalState,
  chatId: string,
  options?: ResumePausedOptions,
): GlobalState {
  let nextGlobal = global;

  const chat = selectChat(nextGlobal, chatId);
  const effectiveLastRead = options?.lastReadInboxMessageId ?? chat?.lastReadInboxMessageId ?? 0;
  const hasUnread = options?.hasUnread ?? Boolean(chat?.unreadCount && chat.unreadCount > 0);

  if (!effectiveLastRead && hasUnread) {
    return nextGlobal;
  }

  Object.values(nextGlobal.byTabId).forEach(({ id: tabId, customerServiceV2 }) => {
    if (!customerServiceV2?.pausedChats || customerServiceV2.settings?.mode !== 'assist') {
      return;
    }

    const pauseInfo = customerServiceV2.pausedChats[chatId];
    if (!pauseInfo?.lastMessageId) {
      return;
    }

    if ((effectiveLastRead && effectiveLastRead >= pauseInfo.lastMessageId) || !hasUnread) {
      const { [chatId]: _removed, ...remainingPaused } = customerServiceV2.pausedChats;
      nextGlobal = updateTabState(nextGlobal, {
        customerServiceV2: {
          ...customerServiceV2,
          pausedChats: Object.keys(remainingPaused).length ? remainingPaused : undefined,
        },
      }, tabId);
    }
  });

  return nextGlobal;
}
