import type { ActionReturnType, TabArgs } from '../../types';
import type { ApiMessage } from '../../../api/types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectTabState, selectChat } from '../../selectors';
import {
  selectCustomerServiceV2State,
  selectCustomerServiceV2Messages,
} from '../../selectors/customerServiceV2';
import { callApi } from '../../../api/gramjs';

/**
 * Add message to Customer Service V2
 * Implements FIFO cleanup at 5000 messages
 */
addActionHandler('addToCustomerServiceV2', (global, actions, payload): ActionReturnType => {
  const { message, chatId, tabId = getCurrentTabId() } = payload;

  try {
    const cs = selectCustomerServiceV2State(global, tabId);

    let messages = cs?.messages || [];

    // Check for duplicate before adding
    const isDuplicate = messages.some((msg) => msg.id === message.id && msg.chatId === chatId);
    if (isDuplicate) {
      console.warn('[CS V2] Duplicate message detected, skipping:', message.id, 'in chat:', chatId);
      return global;
    }

    // FIFO cleanup: Enforce 5000 message limit
    if (messages.length >= 5000) {
      console.warn('[CS V2] Memory limit reached (5000 messages), removing oldest 100 messages');
      messages = messages.slice(-4900); // Keep 4900, add 1 = 4901 (buffer)
    }

    // Performance warning for large message counts
    if (messages.length > 1000 && messages.length % 500 === 0) {
      console.info(`[CS V2 Performance] ${messages.length} messages in memory`);
    }

    // Add new message
    messages = [...messages, message];

    // Update lookup map by chat ID
    const messagesByChatId = {
      ...(cs?.messagesByChatId || {}),
      [chatId]: [...(cs?.messagesByChatId?.[chatId] || []), message],
    };

    return updateTabState(
      global,
      {
        customerServiceV2: {
          ...cs,
          messages,
          messagesByChatId,
          messageCount: messages.length,
          lastSyncTimestamp: Date.now(),
        },
      },
      tabId,
    );
  } catch (error) {
    console.error('[CS V2] Failed to add message:', error);

    actions.showNotification({
      message: 'CustomerServiceSyncError',
      tabId,
    });

    return global;
  }
});

/**
 * Remove message from Customer Service V2
 * Marks message as read in original chat
 */
addActionHandler('removeFromCustomerServiceV2', async (global, actions, payload) => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  try {
    // Mark as read in original chat
    const chat = selectChat(global, chatId);
    if (chat) {
      await callApi('markMessageListRead', {
        chat,
        threadId: undefined,
        maxId: messageId,
      });
    }

    // Remove from CS state
    global = getGlobal();
    const cs = selectCustomerServiceV2State(global, tabId);

    const messages = (cs?.messages || []).filter(
      (msg) => !(msg.chatId === chatId && msg.id === messageId),
    );

    const messagesByChatId = {
      ...(cs?.messagesByChatId || {}),
      [chatId]: (cs?.messagesByChatId?.[chatId] || []).filter((msg) => msg.id !== messageId),
    };

    global = updateTabState(
      global,
      {
        customerServiceV2: {
          ...cs,
          messages,
          messagesByChatId,
          messageCount: messages.length,
          lastSyncTimestamp: Date.now(),
        },
      },
      tabId,
    );

    setGlobal(global);

    // Show confirmation
    actions.showNotification({
      message: 'CustomerServiceMessageRemoved',
      tabId,
    });
  } catch (error) {
    console.error('[CS V2] Failed to remove message:', error);

    actions.showNotification({
      message: 'CustomerServiceSyncError',
      tabId,
    });
  }
});

/**
 * Remove multiple messages from Customer Service V2
 * Used for bulk delete sync
 */
addActionHandler('removeCustomerServiceV2Messages', (global, actions, payload): ActionReturnType => {
  const { messageIds, tabId = getCurrentTabId() } = payload;

  try {
    const cs = selectCustomerServiceV2State(global, tabId);

    // Filter out deleted messages
    const messages = (cs?.messages || []).filter((msg) => !messageIds.includes(msg.id));

    // Rebuild lookup map
    const messagesByChatId: Record<string, ApiMessage[]> = {};
    messages.forEach((msg) => {
      if (!messagesByChatId[msg.chatId]) {
        messagesByChatId[msg.chatId] = [];
      }
      messagesByChatId[msg.chatId].push(msg);
    });

    return updateTabState(
      global,
      {
        customerServiceV2: {
          ...cs,
          messages,
          messagesByChatId,
          messageCount: messages.length,
          lastSyncTimestamp: Date.now(),
        },
      },
      tabId,
    );
  } catch (error) {
    console.error('[CS V2] Failed to remove messages:', error);
    return global;
  }
});

/**
 * Sync message update from original chat
 * Handles edits
 */
addActionHandler('syncCustomerServiceV2Message', (global, actions, payload): ActionReturnType => {
  const { message, tabId = getCurrentTabId() } = payload;

  try {
    const cs = selectCustomerServiceV2State(global, tabId);

    // Find and update message
    const messages = (cs?.messages || []).map((msg) => (msg.id === message.id && msg.chatId === message.chatId ? message : msg));

    // Update in lookup map
    const messagesByChatId = {
      ...(cs?.messagesByChatId || {}),
      [message.chatId]: (cs?.messagesByChatId?.[message.chatId] || []).map((msg) => (msg.id === message.id ? message : msg)),
    };

    return updateTabState(
      global,
      {
        customerServiceV2: {
          ...cs,
          messages,
          messagesByChatId,
          lastSyncTimestamp: Date.now(),
        },
      },
      tabId,
    );
  } catch (error) {
    console.error('[CS V2] Failed to sync message:', error);
    return global;
  }
});

/**
 * Clear all Customer Service V2 messages
 */
addActionHandler('clearCustomerServiceV2Messages', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const cs = selectCustomerServiceV2State(global, tabId);

  return updateTabState(
    global,
    {
      customerServiceV2: {
        ...cs,
        messages: [],
        messagesByChatId: {},
        messageCount: 0,
        lastSyncTimestamp: Date.now(),
      },
    },
    tabId,
  );
});

/**
 * Set context chat (Phase 2)
 * NOTE: This is kept for backward compatibility but not used in isHalfScreen approach
 */
addActionHandler('setCustomerServiceV2Context', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  const cs = selectCustomerServiceV2State(global, tabId);

  return updateTabState(
    global,
    {
      customerServiceV2: {
        ...cs,
        currentContextChatId: chatId,
        currentContextMessageId: messageId,
      },
    },
    tabId,
  );
});

/**
 * Pause chat in assist mode
 */
addActionHandler('pauseCustomerServiceV2Chat', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  const cs = selectCustomerServiceV2State(global, tabId);

  return updateTabState(
    global,
    {
      customerServiceV2: {
        ...cs,
        pausedChats: {
          ...(cs?.pausedChats || {}),
          [chatId]: {
            pausedAt: Date.now(),
            lastMessageId: messageId,
          },
        },
      },
    },
    tabId,
  );
});

/**
 * Resume chat in assist mode
 */
addActionHandler('resumeCustomerServiceV2Chat', (global, actions, payload): ActionReturnType => {
  const { chatId, tabId = getCurrentTabId() } = payload;

  const cs = selectCustomerServiceV2State(global, tabId);

  const pausedChats = { ...(cs?.pausedChats || {}) };
  delete pausedChats[chatId];

  return updateTabState(
    global,
    {
      customerServiceV2: {
        ...cs,
        pausedChats,
      },
    },
    tabId,
  );
});

/**
 * Initialize Customer Service V2 state
 * Called on app init
 */
addActionHandler('initCustomerServiceV2', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const tabState = selectTabState(global, tabId);

  // Only initialize if not already present
  if (!tabState.customerServiceV2) {
    return updateTabState(
      global,
      {
        customerServiceV2: {
          messages: [],
          messagesByChatId: {},
          lastSyncTimestamp: Date.now(),
          messageCount: 0,
        },
      },
      tabId,
    );
  }

  return global;
});
