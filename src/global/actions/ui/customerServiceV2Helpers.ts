import type { GlobalState } from '../../types';
import type { CustomerServiceSettings, CustomerServiceV2State } from '../../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { selectChat } from '../../selectors';
import {
  normalizeCustomerServiceOncallSettings,
  normalizeCustomerServiceQuickReplies,
} from '../../helpers/customerServiceV2Settings';

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
  return state ?? {
    messages: [],
    messagesByChatId: {},
    lastSyncTimestamp: Date.now(),
    messageCount: 0,
  };
}

export function updateCustomerServiceV2State<T extends GlobalState>(
  global: T,
  nextState: CustomerServiceV2State,
): T {
  return { ...global, customerServiceV2: nextState };
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
  };
}

export function getDefaultCustomerServiceV2Settings(): CustomerServiceSettings {
  return mapCustomerServiceConfigToSettings();
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
  };
}

type PauseOptions = {
  pausedAt?: number;
};

export function pauseCustomerServiceChat<T extends GlobalState>(
  global: T,
  chatId: string,
  messageId: number,
  options?: PauseOptions,
): T {
  if (!messageId) {
    return global;
  }

  const cs = global.customerServiceV2;
  if (!cs || cs.settings?.mode !== 'assist') {
    return global;
  }

  const previousEntry = cs.pausedChats?.[chatId];
  if (previousEntry && previousEntry.lastMessageId >= messageId) {
    return global;
  }

  return {
    ...global,
    customerServiceV2: {
      ...cs,
      pausedChats: {
        ...(cs.pausedChats || {}),
        [chatId]: {
          pausedAt: options?.pausedAt ?? Date.now(),
          lastMessageId: messageId,
        },
      },
    },
  };
}

type ResumePausedOptions = {
  lastReadInboxMessageId?: number;
  hasUnread?: boolean;
};

export function resumeCustomerServicePausedChat<T extends GlobalState>(
  global: T,
  chatId: string,
  options?: ResumePausedOptions,
): T {
  const cs = global.customerServiceV2;
  if (!cs?.pausedChats || cs.settings?.mode !== 'assist') {
    return global;
  }

  const chat = selectChat(global, chatId);
  const effectiveLastRead = options?.lastReadInboxMessageId ?? chat?.lastReadInboxMessageId ?? 0;
  const hasUnread = options?.hasUnread ?? Boolean(chat?.unreadCount && chat.unreadCount > 0);

  if (!effectiveLastRead && hasUnread) {
    return global;
  }

  const pauseInfo = cs.pausedChats[chatId];
  if (!pauseInfo?.lastMessageId) {
    return global;
  }

  if ((effectiveLastRead && effectiveLastRead >= pauseInfo.lastMessageId) || !hasUnread) {
    const { [chatId]: _removed, ...remainingPaused } = cs.pausedChats;
    return {
      ...global,
      customerServiceV2: {
        ...cs,
        pausedChats: Object.keys(remainingPaused).length ? remainingPaused : undefined,
      },
    };
  }

  return global;
}
