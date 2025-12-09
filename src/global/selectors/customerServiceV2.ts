import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';
import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID, type CustomerServiceV2State } from '../types/customerServiceV2';

import { loadCustomerServiceV2SettingsFromStorage } from '../helpers/customerServiceV2Settings';
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
 * Returns flat array of messages (max 5000)
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
  const baseSettings = cs?.settings || loadCustomerServiceV2SettingsFromStorage();

  if (!baseSettings) {
    return undefined;
  }

  // 如果没有任何规则，注入一条默认调试规则（检测 foo 自动回复 bar）
  if (!baseSettings.rules || baseSettings.rules.length === 0) {
    return {
      ...baseSettings,
      ruleEngineConfig: {
        enabled: true,
        fallbackToLegacy: true,
        maxExecutionTime: 5000,
        ...baseSettings.ruleEngineConfig,
      },
      rules: [
        {
          id: 'debug_auto_reply_foo_bar',
          name: '[调试] 检测foo自动回复bar',
          enabled: true,
          priority: 5,
          trigger: {
            eventType: 'customer_message',
          },
          pipeline: [
            {
              id: 'check_foo',
              capabilityId: 'check_text_match',
              config: {
                pattern: 'foo',
                mode: '包含',
              },
              onSuccess: { continueNext: true },
              onFailure: { stopPipeline: true },
            },
            {
              id: 'reply_bar',
              capabilityId: 'action_auto_reply',
              config: {
                template: 'bar',
                replyToOriginal: true,
              },
            },
          ],
        },
      ],
    };
  }

  return baseSettings;
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

