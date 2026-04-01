import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';
import type { CustomerServiceV2State } from '../types/customerServiceV2';

import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID } from '../types/customerServiceV2';
import { selectTabState } from './tabs';

export function selectCustomerServiceV2State(
  global: GlobalState,
): CustomerServiceV2State | undefined {
  return global.customerServiceV2;
}

export function selectCustomerServiceV2Messages(
  global: GlobalState,
): ApiMessage[] {
  return global.customerServiceV2?.messages || [];
}

export function selectCustomerServiceV2MessageIds(
  global: GlobalState,
): number[] {
  return selectCustomerServiceV2Messages(global).map((msg) => msg.id);
}

export function selectCustomerServiceV2MessageCount(
  global: GlobalState,
): number {
  return global.customerServiceV2?.messageCount || 0;
}

export function selectIsCustomerServiceV2Open(
  global: GlobalState,
  tabId?: number,
): boolean {
  const { messageLists } = selectTabState(global, tabId);

  if (!messageLists.length) {
    return false;
  }

  const currentMessageList = messageLists[messageLists.length - 1];

  if (currentMessageList?.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID) {
    return true;
  }

  if (currentMessageList?.isHalfScreen) {
    return messageLists.some((ml) => ml.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID);
  }

  return false;
}

export function selectCustomerServiceV2MessagesByChatId(
  global: GlobalState,
  chatId: string,
): ApiMessage[] {
  return global.customerServiceV2?.messagesByChatId[chatId] || [];
}

export function selectCustomerServiceV2Settings(
  global: GlobalState,
) {
  return global.customerServiceV2?.settings;
}

export function selectCustomerServiceV2ContextChatId(
  global: GlobalState,
  tabId?: number,
): string | undefined {
  return selectTabState(global, tabId).customerServiceV2Context?.currentContextChatId;
}

export function selectCustomerServiceV2ContextMessageId(
  global: GlobalState,
  tabId?: number,
): number | undefined {
  return selectTabState(global, tabId).customerServiceV2Context?.currentContextMessageId;
}

export function selectIsCustomerServiceV2ChatPaused(
  global: GlobalState,
  chatId: string,
): boolean {
  return Boolean(global.customerServiceV2?.pausedChats?.[chatId]);
}

export function selectCustomerServiceV2ActiveChatIds(
  global: GlobalState,
): string[] {
  const cs = global.customerServiceV2;
  if (!cs?.messagesByChatId) return [];

  return Object.keys(cs.messagesByChatId).filter(
    (chatId) => cs.messagesByChatId[chatId].length > 0,
  );
}
