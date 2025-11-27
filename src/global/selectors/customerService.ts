import type { ApiMessage } from '../../api/types';
import type { GlobalState, TabState } from '../types';

import { selectTabState } from './';

// 从 localStorage 加载客服设置
function loadSettingsFromStorage() {
  try {
    const stored = localStorage.getItem('customerServiceSettings');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load customer service settings:', error);
    return null;
  }
}

// 选择客服消息列表
export const selectCustomerServiceMessages = (global: GlobalState, tabId?: number): ApiMessage[] => {
  const tabState = selectTabState(global, tabId);
  return tabState.customerService?.messages || [];
};

// 按群组ID选择客服消息
export const selectCustomerServiceMessagesByChatId = (
  global: GlobalState, 
  chatId: string, 
  tabId?: number
): ApiMessage[] => {
  const tabState = selectTabState(global, tabId);
  return tabState.customerService?.messagesByChatId[chatId] || [];
};

// 选择客服状态
export const selectCustomerServiceState = (global: GlobalState, tabId?: number): TabState['customerService'] => {
  const tabState = selectTabState(global, tabId);
  return tabState.customerService;
};

// 选择最后更新时间
export const selectCustomerServiceLastUpdated = (global: GlobalState, tabId?: number): number => {
  const tabState = selectTabState(global, tabId);
  return tabState.customerService?.lastUpdated || 0;
};

// 检查是否有客服消息
export const selectHasCustomerServiceMessages = (global: GlobalState, tabId?: number): boolean => {
  const messages = selectCustomerServiceMessages(global, tabId);
  return messages.length > 0;
};

// 获取监听的群组中有消息的群组ID列表
export const selectActiveCustomerServiceChatIds = (global: GlobalState, tabId?: number): string[] => {
  const tabState = selectTabState(global, tabId);
  if (!tabState.customerService?.messagesByChatId) {
    return [];
  }
  
  return Object.keys(tabState.customerService.messagesByChatId).filter(
    chatId => tabState.customerService!.messagesByChatId[chatId].length > 0
  );
};

// 选择当前正在回复的消息
export const selectCustomerServiceReplyingMessage = (global: GlobalState, tabId?: number): ApiMessage | undefined => {
  const tabState = selectTabState(global, tabId);
  return tabState.customerService?.replyingToMessage;
};

// 检查消息是否已回复
export const selectIsMessageReplied = (global: GlobalState, chatId: string, messageId: number, tabId?: number): boolean => {
  const tabState = selectTabState(global, tabId);
  const messageKey = `${chatId}-${messageId}`;
  const repliedMessageIds = tabState.customerService?.repliedMessageIds;
  return Array.isArray(repliedMessageIds) && repliedMessageIds.includes(messageKey) || false;
};

// 选择客服设置
export const selectCustomerServiceSettings = (global: GlobalState, tabId?: number) => {
  const tabState = selectTabState(global, tabId);
  const settings = tabState.customerService?.settings;
  
  // 如果全局状态中没有设置，尝试从 localStorage 加载（向后兼容）
  if (!settings) {
    return loadSettingsFromStorage();
  }
  
  return settings;
};