import type { GlobalState } from '../../types';
import type { CustomerServiceSettings, CustomerServiceV2State } from '../../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { normalizeCustomerServiceQuickReplies } from '../../helpers/customerServiceV2Settings';

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

export function getDefaultCustomerServiceV2Settings(): CustomerServiceSettings {
  return {
    monitoredChatIds: [...CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS],
    filteredUserIds: [...CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS],
    regexFilters: (CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS || []).map((filter) => {
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
    }),
    mode: 'oncall',
    autoRead: false,
    quickReplies: normalizeCustomerServiceQuickReplies(CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES),
    quickReplyPanelGlobal: false,
    enableMessageGrouping: CUSTOMER_SERVICE_CONFIG.ENABLE_MESSAGE_GROUPING,
    messageGroupingWindow: CUSTOMER_SERVICE_CONFIG.MESSAGE_GROUPING_WINDOW,
  };
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
  };
}
