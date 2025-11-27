import type { ApiFormattedText } from '../api/types';
import type { GlobalState } from '../global/types';
import type { CustomerServiceSettings } from '../global/types/customerServiceV2';

import { selectCustomerServiceSettings } from '../global/selectors/customerService';
import { selectCustomerServiceV2Settings } from '../global/selectors/customerServiceV2';

// Customer Service Configuration
export const CUSTOMER_SERVICE_CONFIG = {
  // 监听的群组ID列表 - 这里填写实际的群组ID
  MONITORED_CHAT_IDS: [
    // 示例群组ID，实际使用时请替换为真实的群组ID
    '-1001234567890', // 技术支持群
    '-4618248704', // 产品反馈群
    '-4549167178', // 用户咨询群
  ],

  // 过滤的用户ID列表 - 过滤机器人和不需要客服回复的用户
  FILTERED_USER_IDS: [
    // 示例用户ID，请填写实际需要过滤的用户ID
    // '123456789', // 某个机器人ID
    // '987654321', // 另一个需要过滤的用户ID
  ],

  // 正则表达式过滤规则 - 过滤特定内容的消息（无需回复）
  REGEX_FILTERS: [
    // 示例正则表达式，请根据需要添加
    // /^\/\w+/, // 过滤所有以 / 开头的命令
    // /^@\w+/, // 过滤所有 @ 提及
    // /^\[系统\]/, // 过滤系统消息
  ],

  // 客服消息的最大保存数量
  MAX_MESSAGES_DISPLAY: 100,

  // 自动刷新间隔（毫秒）
  AUTO_REFRESH_INTERVAL: 5000,

  // 消息过期时间（24小时，单位：毫秒）
  MESSAGE_EXPIRE_TIME: 24 * 60 * 60 * 1000,
} as const;

// 检查是否为监听的客服群组
const getEffectiveSettings = (global?: GlobalState): CustomerServiceSettings | undefined => {
  if (!global) {
    return undefined;
  }

  const v2Settings = selectCustomerServiceV2Settings(global);
  if (v2Settings) {
    return v2Settings;
  }

  const legacySettings = selectCustomerServiceSettings(global);
  if (!legacySettings) {
    return undefined;
  }

  return {
    monitoredChatIds: legacySettings.monitoredChatIds || [],
    filteredUserIds: legacySettings.filteredUserIds || [],
    regexFilters: (legacySettings.regexFilters || []).map((filter: any) => {
      if (!filter) {
        return { source: '', flags: '' };
      }

      if (filter instanceof RegExp) {
        return { source: filter.source, flags: filter.flags };
      }

      if (typeof filter.source === 'string') {
        return {
          source: filter.source,
          flags: typeof filter.flags === 'string' ? filter.flags : '',
        };
      }

      if (typeof filter === 'string') {
        return { source: filter, flags: '' };
      }

      return { source: '', flags: '' };
    }).filter((filter) => Boolean(filter.source)) as Array<{ source: string; flags: string }>,
    mode: legacySettings.mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(legacySettings.autoRead),
  };
};

const mergeRegexFilters = (global?: GlobalState): RegExp[] => {
  const filters = [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS];
  const settings = getEffectiveSettings(global);

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
};

export const isMonitoredChat = (chatId: string, global?: GlobalState): boolean => {
  const settings = getEffectiveSettings(global);
  if (settings?.monitoredChatIds?.includes(chatId)) {
    return true;
  }

  return CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.includes(chatId);
};

// 检查用户是否被过滤（机器人或不需要客服回复的用户）
export const isFilteredUser = (userId?: string, global?: GlobalState): boolean => {
  if (!userId) return false;

  const settings = getEffectiveSettings(global);
  if (settings?.filteredUserIds?.includes(userId)) {
    return true;
  }

  return CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS.includes(userId);
};

// 检查消息内容是否匹配过滤正则表达式
export const isFilteredByRegex = (messageText?: ApiFormattedText, global?: GlobalState): boolean => {
  if (!messageText) return false;

  const regexFilters = mergeRegexFilters(global);

  return regexFilters.some((regex) => {
    try {
      return regex.test(messageText.text);
    } catch (error) {
      return false;
    }
  });
};

// 综合检查消息是否应该被过滤掉
export const shouldFilterMessage = (
  chatId: string,
  senderId?: string,
  messageText?: ApiFormattedText,
  global?: GlobalState,
): boolean => {
  // 不是监听的群组，过滤掉
  if (!isMonitoredChat(chatId, global)) {
    return true;
  }

  // 用户被过滤，过滤掉
  if (isFilteredUser(senderId, global)) {
    return true;
  }

  // 消息内容匹配过滤正则，过滤掉
  if (isFilteredByRegex(messageText, global)) {
    return true;
  }

  return false;
};
