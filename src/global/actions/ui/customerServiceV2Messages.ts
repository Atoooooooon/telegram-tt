import type { ApiMessage } from '../../../api/types';
import type { ActionReturnType } from '../../types';
import type { CustomerServiceV2State } from '../../types/customerServiceV2';
import { MAIN_THREAD_ID } from '../../../api/types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { callApi } from '../../../api/gramjs';
import { loadCustomerServiceV2SettingsFromStorage } from '../../helpers/customerServiceV2Settings';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { selectChat } from '../../selectors';
import { selectCustomerServiceV2State } from '../../selectors/customerServiceV2';

import {
  ensureCustomerServiceV2State,
  getDefaultCustomerServiceV2Settings,
  pauseCustomerServiceChat,
  syncCustomerServiceV2StateAcrossTabs,
} from './customerServiceV2Helpers';

/**
 * Add message to Customer Service V2
 * Implements FIFO cleanup at 5000 messages
 */
addActionHandler('addToCustomerServiceV2', (global, actions, payload): ActionReturnType => {
  const { message, chatId, tabId = getCurrentTabId() } = payload;

  try {
    const cs = selectCustomerServiceV2State(global, tabId);
    const baseState = ensureCustomerServiceV2State(cs);

    let messages = baseState.messages;

    // Check for duplicate before adding
    const isDuplicate = messages.some((msg) => msg.id === message.id && msg.chatId === chatId);
    if (isDuplicate) {
      return global;
    }

    // In assist mode, remove previous messages from this chat if they were read
    const chat = selectChat(global, chatId);
    const existingChatMessages = baseState.messagesByChatId[chatId] || [];

    // eslint-disable-next-line no-console
    console.log('[CS-Debug] addToCustomerServiceV2:', {
      chatId,
      newMessageId: message.id,
      mode: baseState.settings?.mode,
      existingChatMessages: existingChatMessages.map((m) => m.id),
      chatLastReadInboxMessageId: chat?.lastReadInboxMessageId,
      chatUnreadCount: chat?.unreadCount,
    });

    // In assist mode, remove read messages from customer service window when new message arrives
    if (baseState.settings?.mode === 'assist' && chat?.lastReadInboxMessageId) {
      const readMessageIds = existingChatMessages
        .filter((msg) => msg.id <= chat.lastReadInboxMessageId!)
        .map((msg) => msg.id);

      if (readMessageIds.length > 0) {
        // eslint-disable-next-line no-console
        console.log('[CS-Debug] Removing read messages:', readMessageIds);

        messages = messages.filter(
          (msg) => !(msg.chatId === chatId && readMessageIds.includes(msg.id)),
        );
      }
    }

    // FIFO cleanup: Different limits based on mode
    // Assist mode: Keep fewer messages since each chat only needs latest unread message
    // On-call mode: Keep more messages for history
    const maxMessages = baseState.settings?.mode === 'assist' ? 500 : 5000;
    const keepMessages = baseState.settings?.mode === 'assist' ? 450 : 4900;

    if (messages.length >= maxMessages) {
      messages = messages.slice(-keepMessages);

      // eslint-disable-next-line no-console
      console.log('[CS-Debug] FIFO cleanup triggered:', {
        mode: baseState.settings?.mode,
        before: messages.length + (maxMessages - keepMessages),
        after: messages.length,
      });
    }

    // Add new message
    messages = [...messages, message];

    // Update lookup map by chat ID
    // Filter out read messages from existing chat messages
    let chatMessages = existingChatMessages;
    if (baseState.settings?.mode === 'assist' && chat?.lastReadInboxMessageId) {
      chatMessages = chatMessages.filter((msg) => msg.id > chat.lastReadInboxMessageId!);
    }

    // Add new message to chat messages
    chatMessages = [...chatMessages, message];

    const messagesByChatId = {
      ...baseState.messagesByChatId,
      [chatId]: chatMessages,
    };

    const settings = baseState.settings
      || loadCustomerServiceV2SettingsFromStorage()
      || getDefaultCustomerServiceV2Settings();

    const nextState: CustomerServiceV2State = {
      ...baseState,
      messages,
      messagesByChatId,
      messageCount: messages.length,
      lastSyncTimestamp: Date.now(),
      pausedChats: baseState.pausedChats,
      settings,
    };

    let nextGlobal = syncCustomerServiceV2StateAcrossTabs(global, nextState);

    if (settings.mode === 'assist') {
      nextGlobal = pauseCustomerServiceChat(nextGlobal, chatId, message.id);
    }

    return nextGlobal;
  } catch (error) {
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
addActionHandler('removeFromCustomerServiceV2', async (global, actions, payload): Promise<void> => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  try {
    // Mark as read in original chat
    const chat = selectChat(global, chatId);
    if (chat) {
      await callApi('markMessageListRead', {
        chat,
        threadId: MAIN_THREAD_ID,
        maxId: messageId,
      });
    }

    // Remove from CS state
    global = getGlobal();
    const cs = selectCustomerServiceV2State(global, tabId);
    const baseState = ensureCustomerServiceV2State(cs);
    const messages = baseState.messages.filter(
      (msg) => !(msg.chatId === chatId && msg.id === messageId),
    );

    const messagesByChatId = {
      ...baseState.messagesByChatId,
      [chatId]: (baseState.messagesByChatId[chatId] || []).filter((msg) => msg.id !== messageId),
    };

    const nextState: CustomerServiceV2State = {
      ...baseState,
      messages,
      messagesByChatId,
      messageCount: messages.length,
      lastSyncTimestamp: Date.now(),
    };

    let pausedChats = nextState.pausedChats;
    if (nextState.settings?.mode === 'assist' && (!messagesByChatId[chatId] || messagesByChatId[chatId].length === 0)) {
      if (pausedChats && pausedChats[chatId]) {
        const { [chatId]: _removed, ...rest } = pausedChats;
        pausedChats = rest;
      }
      nextState.pausedChats = pausedChats;
    }

    global = syncCustomerServiceV2StateAcrossTabs(global, nextState);

    setGlobal(global);

    // Show confirmation
    actions.showNotification({
      message: 'CustomerServiceMessageRemoved',
      tabId,
    });
  } catch (error) {
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
    const baseState = ensureCustomerServiceV2State(cs);

    // Filter out deleted messages
    const messages = baseState.messages.filter((msg) => !messageIds.includes(msg.id));

    // Rebuild lookup map
    const messagesByChatId: Record<string, ApiMessage[]> = {};
    messages.forEach((msg) => {
      if (!messagesByChatId[msg.chatId]) {
        messagesByChatId[msg.chatId] = [];
      }
      messagesByChatId[msg.chatId].push(msg);
    });

    const nextState: CustomerServiceV2State = {
      ...baseState,
      messages,
      messagesByChatId,
      messageCount: messages.length,
      lastSyncTimestamp: Date.now(),
    };

    if (nextState.settings?.mode === 'assist' && nextState.pausedChats) {
      const updatedPaused: typeof nextState.pausedChats = {};
      const pausedChatIds = Object.keys(nextState.pausedChats);
      for (let i = 0; i < pausedChatIds.length; i += 1) {
        const pausedChatId = pausedChatIds[i];
        const value = nextState.pausedChats[pausedChatId];
        if (!value) {
          continue;
        }
        if ((messagesByChatId[pausedChatId] || []).length > 0) {
          updatedPaused[pausedChatId] = value;
        }
      }
      nextState.pausedChats = updatedPaused;
    }

    return syncCustomerServiceV2StateAcrossTabs(global, nextState);
  } catch (error) {
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
    const baseState = ensureCustomerServiceV2State(cs);

    // Find and update message
    const messages = baseState.messages.map((msg) => (
      msg.id === message.id && msg.chatId === message.chatId ? message : msg
    ));

    // Update in lookup map
    const messagesByChatId = {
      ...baseState.messagesByChatId,
      [message.chatId]: (baseState.messagesByChatId[message.chatId] || []).map((msg) => (
        msg.id === message.id ? message : msg
      )),
    };

    const nextState: CustomerServiceV2State = {
      ...baseState,
      messages,
      messagesByChatId,
      lastSyncTimestamp: Date.now(),
    };

    return syncCustomerServiceV2StateAcrossTabs(global, nextState);
  } catch (error) {
    return global;
  }
});

/**
 * Clear all Customer Service V2 messages
 */
addActionHandler('clearCustomerServiceV2Messages', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId() } = payload || {};

  const cs = selectCustomerServiceV2State(global, tabId);
  const baseState = ensureCustomerServiceV2State(cs);

  const markReadPromises = Object.entries(baseState.messagesByChatId || {}).map(([chatId, chatMessages]) => {
    if (!chatMessages || chatMessages.length === 0) {
      return undefined;
    }

    const chat = selectChat(global, chatId);
    if (!chat) {
      return undefined;
    }

    const maxMessageId = chatMessages.reduce((max, { id }) => (id > max ? id : max), 0);
    if (!maxMessageId) {
      return undefined;
    }

    return callApi('markMessageListRead', {
      chat,
      threadId: MAIN_THREAD_ID,
      maxId: maxMessageId,
    }).catch(() => undefined);
  }).filter(Boolean) as Promise<unknown>[];

  const nextState: CustomerServiceV2State = {
    ...baseState,
    messages: [],
    messagesByChatId: {},
    messageCount: 0,
    lastSyncTimestamp: Date.now(),
  };

  global = syncCustomerServiceV2StateAcrossTabs(global, nextState);

  setGlobal(global);

  if (markReadPromises.length > 0) {
    await Promise.allSettled(markReadPromises);
  }
});
