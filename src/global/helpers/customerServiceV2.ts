import type { ApiFormattedText, ApiMessage } from '../../api/types';
import type { CustomerServiceSettings, GlobalState } from '../types';

import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';
import { selectCustomerServiceV2Settings } from '../selectors/customerServiceV2';
import {
  loadCustomerServiceV2SettingsFromStorage,
  normalizeCustomerServiceQuickReplies,
} from './customerServiceV2Settings';

/**
 * Get effective customer service settings
 * Merges stored settings with default config values
 */
export function getEffectiveCustomerServiceSettings(
  global?: GlobalState,
): CustomerServiceSettings | undefined {
  if (!global) {
    return undefined;
  }

  const v2Settings = selectCustomerServiceV2Settings(global) || loadCustomerServiceV2SettingsFromStorage();
  if (!v2Settings) {
    return undefined;
  }

  const quickReplies = normalizeCustomerServiceQuickReplies(
    v2Settings.quickReplies && v2Settings.quickReplies.length
      ? v2Settings.quickReplies
      : CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES,
  );

  return {
    ...v2Settings,
    quickReplies,
    quickReplyPanelGlobal: Boolean(v2Settings.quickReplyPanelGlobal),
  };
}

/**
 * Merge configured regex filters with settings
 */
export function getMergedRegexFilters(global?: GlobalState): RegExp[] {
  const filters = [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS];
  const settings = getEffectiveCustomerServiceSettings(global);

  if (!settings?.regexFilters?.length) {
    return filters;
  }

  settings.regexFilters.forEach((filter) => {
    try {
      filters.push(new RegExp(filter.source, filter.flags));
    } catch (error) {
      // Ignore malformed filters
    }
  });

  return filters;
}

/**
 * Check if a chat is being monitored for customer service
 */
export function isMonitoredChat(chatId: string, global?: GlobalState): boolean {
  const settings = getEffectiveCustomerServiceSettings(global);
  if (settings?.monitoredChatIds?.includes(chatId)) {
    return true;
  }

  return CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.includes(chatId);
}

/**
 * Check if a user is filtered (blocked)
 */
export function isFilteredUser(userId: string, global?: GlobalState): boolean {
  const settings = getEffectiveCustomerServiceSettings(global);
  if (settings?.filteredUserIds?.includes(userId)) {
    return true;
  }

  return CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS.includes(userId);
}

/**
 * Check if message text matches regex filters
 */
export function isFilteredByRegex(messageText: string, global?: GlobalState): boolean {
  const filters = getMergedRegexFilters(global);

  return filters.some((regex) => {
    try {
      return regex.test(messageText);
    } catch (error) {
      return false;
    }
  });
}

export function isFilteredCustomerServiceActionMessage(message: ApiMessage): boolean {
  const actionType = message.content.action?.type;

  return actionType === 'chatAddUser'
    || actionType === 'chatDeleteUser'
    || actionType === 'chatJoinedByLink'
    || actionType === 'chatJoinedByRequest'
    || actionType === 'channelJoined';
}

/**
 * Comprehensive check if message should be filtered
 */
export function shouldFilterMessage(
  chatId: string,
  senderId?: string,
  messageText?: ApiFormattedText,
  global?: GlobalState,
  message?: ApiMessage,
): boolean {
  if (message && isFilteredCustomerServiceActionMessage(message)) {
    return true;
  }

  // User is filtered, skip message
  if (senderId && isFilteredUser(senderId, global)) {
    return true;
  }

  // Message content matches regex filter, skip message
  if (messageText?.text && isFilteredByRegex(messageText.text, global)) {
    return true;
  }

  return false;
}
