import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';
import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID, type CustomerServiceV2State } from '../types/customerServiceV2';

import { selectTabState } from './tabs';

/**
 * Select full Customer Service V2 state
 */
export function selectCustomerServiceV2State(
  global: GlobalState,
  tabId?: number,
): CustomerServiceV2State | undefined {
  const tabState = selectTabState(global, tabId);
  return tabState.customerServiceV2;
}

/**
 * Select all Customer Service V2 messages
 * Returns flat array of in-memory CS messages
 */
export function selectCustomerServiceV2Messages(
  global: GlobalState,
  tabId?: number,
): ApiMessage[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messages || [];
}

/**
 * Select Customer Service V2 message IDs as flat array
 * Used for MessageList component
 */
export function selectCustomerServiceV2MessageIds(
  global: GlobalState,
  tabId?: number,
): number[] {
  const messages = selectCustomerServiceV2Messages(global, tabId);
  return messages.map((msg) => msg.id);
}

/**
 * Select Customer Service V2 message count
 * Optimized with cached value from state
 */
export function selectCustomerServiceV2MessageCount(
  global: GlobalState,
  tabId?: number,
): number {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messageCount || 0;
}

/**
 * Check if Customer Service V2 view is currently open
 * Returns true when current message list chatId matches virtual chatId
 */
export function selectIsCustomerServiceV2Open(
  global: GlobalState,
  tabId?: number,
): boolean {
  const tabState = selectTabState(global, tabId);
  const { messageLists } = tabState;

  if (!messageLists.length) {
    return false;
  }

  const currentMessageList = messageLists[messageLists.length - 1];

  if (currentMessageList?.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID) {
    return true;
  }

  if (currentMessageList?.isHalfScreen) {
    return messageLists.some((messageList) => messageList.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID);
  }

  return false;
}

/**
 * Select messages by chat ID
 * Used for source badge and multi-chat display
 */
export function selectCustomerServiceV2MessagesByChatId(
  global: GlobalState,
  chatId: string,
  tabId?: number,
): ApiMessage[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messagesByChatId[chatId] || [];
}

/**
 * Select Customer Service V2 settings
 * Shared with V1 for compatibility
 */
export function selectCustomerServiceV2Settings(
  global: GlobalState,
  tabId?: number,
) {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.settings;
}

/**
 * Select current context chat ID (Phase 2)
 */
export function selectCustomerServiceV2ContextChatId(
  global: GlobalState,
  tabId?: number,
): string | undefined {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.currentContextChatId;
}

/**
 * Select current context message ID (Phase 2)
 */
export function selectCustomerServiceV2ContextMessageId(
  global: GlobalState,
  tabId?: number,
): number | undefined {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.currentContextMessageId;
}

/**
 * Check if a specific chat is paused in assist mode
 */
export function selectIsCustomerServiceV2ChatPaused(
  global: GlobalState,
  chatId: string,
  tabId?: number,
): boolean {
  const cs = selectCustomerServiceV2State(global, tabId);
  return Boolean(cs?.pausedChats?.[chatId]);
}

/**
 * Select all active chat IDs with CS messages
 * Used for overview and statistics
 */
export function selectCustomerServiceV2ActiveChatIds(
  global: GlobalState,
  tabId?: number,
): string[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  if (!cs?.messagesByChatId) return [];

  return Object.keys(cs.messagesByChatId).filter(
    (chatId) => cs.messagesByChatId[chatId].length > 0,
  );
}
