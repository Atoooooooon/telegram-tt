import type { ApiMessage } from '../../api/types';
import type { GlobalState, TabArgs } from '../types';
import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID, type CustomerServiceV2State } from '../types/customerServiceV2';

import { selectTabState } from './tabs';

/**
 * Select full Customer Service V2 state
 */
export function selectCustomerServiceV2State<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): CustomerServiceV2State | undefined {
  const tabState = selectTabState(global, tabId);
  return tabState.customerServiceV2;
}

/**
 * Select all Customer Service V2 messages
 * Returns flat array of messages (max 5000)
 */
export function selectCustomerServiceV2Messages<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): ApiMessage[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messages || [];
}

/**
 * Select Customer Service V2 message IDs as flat array
 * Used for MessageList component
 */
export function selectCustomerServiceV2MessageIds<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): number[] {
  const messages = selectCustomerServiceV2Messages(global, tabId);
  return messages.map((msg) => msg.id);
}

/**
 * Select Customer Service V2 message count
 * Optimized with cached value from state
 */
export function selectCustomerServiceV2MessageCount<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): number {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messageCount || 0;
}

/**
 * Check if Customer Service V2 view is currently open
 * Returns true when current message list chatId matches virtual chatId
 */
export function selectIsCustomerServiceV2Open<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): boolean {
  const tabState = selectTabState(global, tabId);
  const { messageLists } = tabState;

  // Get the current (last) message list
  if (messageLists.length) {
    const currentMessageList = messageLists[messageLists.length - 1];
    return currentMessageList?.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID;
  }

  return false;
}

/**
 * Select messages by chat ID
 * Used for source badge and multi-chat display
 */
export function selectCustomerServiceV2MessagesByChatId<T extends GlobalState>(
  global: T,
  chatId: string,
  ...[tabId]: TabArgs<T>
): ApiMessage[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.messagesByChatId[chatId] || [];
}

/**
 * Select Customer Service V2 settings
 * Shared with V1 for compatibility
 */
export function selectCustomerServiceV2Settings<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
) {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.settings;
}

/**
 * Select current context chat ID (Phase 2)
 */
export function selectCustomerServiceV2ContextChatId<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): string | undefined {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.currentContextChatId;
}

/**
 * Select current context message ID (Phase 2)
 */
export function selectCustomerServiceV2ContextMessageId<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): number | undefined {
  const cs = selectCustomerServiceV2State(global, tabId);
  return cs?.currentContextMessageId;
}

/**
 * Check if a specific chat is paused in assist mode
 */
export function selectIsCustomerServiceV2ChatPaused<T extends GlobalState>(
  global: T,
  chatId: string,
  ...[tabId]: TabArgs<T>
): boolean {
  const cs = selectCustomerServiceV2State(global, tabId);
  return Boolean(cs?.pausedChats?.[chatId]);
}

/**
 * Select all active chat IDs with CS messages
 * Used for overview and statistics
 */
export function selectCustomerServiceV2ActiveChatIds<T extends GlobalState>(
  global: T,
  ...[tabId]: TabArgs<T>
): string[] {
  const cs = selectCustomerServiceV2State(global, tabId);
  if (!cs?.messagesByChatId) return [];

  return Object.keys(cs.messagesByChatId).filter(
    (chatId) => cs.messagesByChatId[chatId].length > 0,
  );
}
