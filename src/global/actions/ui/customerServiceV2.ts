import type { ApiMessage } from '../../../api/types';
import type { ActionReturnType } from '../../types';
import type { CustomerServiceSettings, CustomerServiceV2State } from '../../types/customerServiceV2';
import { MAIN_THREAD_ID } from '../../../api/types';

import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { EDITABLE_INPUT_ID } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { callApi } from '../../../api/gramjs';
import {
  loadCustomerServiceV2SettingsFromStorage,
  normalizeCustomerServiceQuickReplies,
  saveCustomerServiceV2SettingsToStorage,
} from '../../helpers/customerServiceV2Settings';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectChat, selectCurrentMessageList, selectTabState } from '../../selectors';
import {
  selectCustomerServiceV2Settings,
  selectCustomerServiceV2State,
} from '../../selectors/customerServiceV2';
import useLang from '../../../hooks/useLang';

function ensureCustomerServiceV2State(state?: CustomerServiceV2State): CustomerServiceV2State {
  if (state) {
    return state;
  }

  return {
    messages: [],
    messagesByChatId: {},
    repliedMessageIds: [],
    lastSyncTimestamp: Date.now(),
    messageCount: 0,
  };
}

function getDefaultCustomerServiceV2Settings(): CustomerServiceSettings {
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
  };
}

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

    // FIFO cleanup: Enforce 5000 message limit
    if (messages.length >= 5000) {
      messages = messages.slice(-4900); // Keep 4900, add 1 = 4901 (buffer)
    }

    // Performance warning for large message counts
    if (messages.length > 1000 && messages.length % 500 === 0) {
      // noop: can add telemetry hook here if needed
    }

    // Add new message
    messages = [...messages, message];

    // Update lookup map by chat ID
    const messagesByChatId = {
      ...baseState.messagesByChatId,
      [chatId]: [...(baseState.messagesByChatId[chatId] || []), message],
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

    if (settings.mode === 'assist') {
      nextState.pausedChats = {
        ...(nextState.pausedChats || {}),
        [chatId]: {
          pausedAt: Date.now(),
          lastMessageId: message.id,
        },
      };
    };

    return updateTabState(
      global,
      {
        customerServiceV2: nextState,
      },
      tabId,
    );
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
    const lang = useLang();
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

    global = updateTabState(
      global,
      {
        customerServiceV2: nextState,
      },
      tabId,
    );

    setGlobal(global);

    // Show confirmation
    actions.showNotification({
      message: lang('CustomerServiceMessageRemoved'),
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
      Object.entries(nextState.pausedChats).forEach(([pausedChatId, value]) => {
        if ((messagesByChatId[pausedChatId] || []).length > 0) {
          updatedPaused[pausedChatId] = value;
        }
      });
      nextState.pausedChats = updatedPaused;
    }

    return updateTabState(
      global,
      {
        customerServiceV2: nextState,
      },
      tabId,
    );
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

    return updateTabState(
      global,
      {
        customerServiceV2: nextState,
      },
      tabId,
    );
  } catch (error) {
    return global;
  }
});

/**
 * Clear all Customer Service V2 messages
 */
addActionHandler('clearCustomerServiceV2Messages', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const cs = selectCustomerServiceV2State(global, tabId);
  const baseState = ensureCustomerServiceV2State(cs);

  const nextState: CustomerServiceV2State = {
    ...baseState,
    messages: [],
    messagesByChatId: {},
    messageCount: 0,
    lastSyncTimestamp: Date.now(),
    pausedChats: baseState.settings?.mode === 'assist' ? {} : baseState.pausedChats,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
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
  const baseState = ensureCustomerServiceV2State(cs);

  const nextState: CustomerServiceV2State = {
    ...baseState,
    currentContextChatId: chatId,
    currentContextMessageId: messageId,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
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
  const baseState = ensureCustomerServiceV2State(cs);

  const nextState: CustomerServiceV2State = {
    ...baseState,
    pausedChats: {
      ...(baseState.pausedChats || {}),
      [chatId]: {
        pausedAt: Date.now(),
        lastMessageId: messageId,
      },
    },
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
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
  const baseState = ensureCustomerServiceV2State(cs);

  const pausedChats = { ...(baseState.pausedChats || {}) };
  delete pausedChats[chatId];

  const nextState: CustomerServiceV2State = {
    ...baseState,
    pausedChats,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
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
    const settings = loadCustomerServiceV2SettingsFromStorage() || undefined;
    const initialState: CustomerServiceV2State = {
      messages: [],
      messagesByChatId: {},
      lastSyncTimestamp: Date.now(),
      messageCount: 0,
      ...(settings ? { settings } : {}),
    };

    return updateTabState(
      global,
      {
        customerServiceV2: initialState,
      },
      tabId,
    );
  }

  return global;
});

addActionHandler('initializeCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const cs = selectCustomerServiceV2State(global, tabId);

  if (cs?.settings) {
    return global;
  }

  const storedSettings = loadCustomerServiceV2SettingsFromStorage();
  if (!storedSettings) {
    return global;
  }

  const baseState = ensureCustomerServiceV2State(cs);
  const nextState: CustomerServiceV2State = {
    ...baseState,
    settings: storedSettings,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
    },
    tabId,
  );
});

addActionHandler('openCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  actions.initializeCustomerServiceV2Settings({ tabId });

  return updateTabState(
    global,
    {
      isCustomerServiceV2SettingsOpen: true,
    },
    tabId,
  );
});

addActionHandler('applyCustomerServiceQuickReply', (global, actions, payload): ActionReturnType => {
  const { quickReply, tabId = getCurrentTabId() } = payload;

  const trimmedText = quickReply.text.trim();
  if (!trimmedText) {
    return global;
  }

  const currentMessageList = selectCurrentMessageList(global, tabId);
  if (!currentMessageList?.chatId) {
    return global;
  }

  const messageListDescriptor = {
    chatId: currentMessageList.chatId,
    threadId: currentMessageList.threadId,
    type: currentMessageList.type,
    isHalfScreen: currentMessageList.isHalfScreen,
  };

  if (quickReply.mode === 'insert') {
    const input = document.getElementById(EDITABLE_INPUT_ID);
    const existingText = input?.textContent ?? '';
    let combinedText = trimmedText;

    if (existingText.trim().length) {
      const needsSpace = !/[\s\n]$/.test(existingText);
      combinedText = `${existingText}${needsSpace ? ' ' : ''}${trimmedText}`;
    }

    actions.openChatWithDraft({
      chatId: messageListDescriptor.chatId,
      threadId: messageListDescriptor.threadId,
      text: { text: combinedText },
      tabId,
    });
  } else {
    actions.sendMessage({
      messageList: messageListDescriptor,
      text: trimmedText,
      tabId,
    });
  }

  return global;
});

addActionHandler('closeCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(
    global,
    {
      isCustomerServiceV2SettingsOpen: false,
    },
    tabId,
  );
});

addActionHandler('toggleCustomerServiceV2Mode', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const cs = selectCustomerServiceV2State(global, tabId);
  const baseState = ensureCustomerServiceV2State(cs);

  const existingSettings = baseState.settings
    || loadCustomerServiceV2SettingsFromStorage()
    || getDefaultCustomerServiceV2Settings();

  const nextMode: CustomerServiceSettings['mode'] = existingSettings.mode === 'assist' ? 'oncall' : 'assist';

  const updatedSettings: CustomerServiceSettings = {
    monitoredChatIds: existingSettings.monitoredChatIds || [],
    filteredUserIds: existingSettings.filteredUserIds || [],
    regexFilters: existingSettings.regexFilters || [],
    autoRead: Boolean(existingSettings.autoRead),
    mode: nextMode,
    quickReplies: normalizeCustomerServiceQuickReplies(
      existingSettings.quickReplies && existingSettings.quickReplies.length
        ? existingSettings.quickReplies
        : CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES,
    ),
    quickReplyPanelGlobal: Boolean(existingSettings.quickReplyPanelGlobal),
  };

  const normalized = normalizeSettingsForSave(updatedSettings);
  saveCustomerServiceV2SettingsToStorage(normalized);

  const nextState: CustomerServiceV2State = {
    ...baseState,
    settings: normalized,
    pausedChats: nextMode === 'assist' ? baseState.pausedChats : undefined,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
    },
    tabId,
  );
});

addActionHandler('checkPausedChatsStatusV2', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const cs = selectCustomerServiceV2State(global, tabId);

  if (!cs?.pausedChats || !cs.settings || cs.settings.mode !== 'assist') {
    return global;
  }

  const updatedPausedChats = { ...cs.pausedChats };
  let hasChanges = false;

  Object.entries(cs.pausedChats).forEach(([chatId, pauseInfo]) => {
    const chat = selectChat(global, chatId);
    if (!chat) {
      return;
    }

    const lastTrackedMessageId = pauseInfo.lastMessageId;
    if (!lastTrackedMessageId) {
      delete updatedPausedChats[chatId];
      hasChanges = true;
      return;
    }

    const isRead = Boolean(chat.lastReadInboxMessageId && chat.lastReadInboxMessageId >= lastTrackedMessageId);
    const hasUnread = chat.unreadCount && chat.unreadCount > 0;
    const replyKey = `${chatId}-${lastTrackedMessageId}`;
    const isReplied = Boolean(cs.repliedMessageIds && cs.repliedMessageIds.includes(replyKey));

    if (isRead || isReplied || !hasUnread) {
      delete updatedPausedChats[chatId];
      hasChanges = true;
    }
  });

  if (!hasChanges) {
    return global;
  }

  const nextState: CustomerServiceV2State = {
    ...cs,
    pausedChats: Object.keys(updatedPausedChats).length ? updatedPausedChats : undefined,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
    },
    tabId,
  );
});

function normalizeSettingsForSave(settings: CustomerServiceSettings): CustomerServiceSettings {
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

addActionHandler('saveCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { settings, tabId = getCurrentTabId() } = payload;

  const cs = selectCustomerServiceV2State(global, tabId);
  const normalized = normalizeSettingsForSave(settings);

  saveCustomerServiceV2SettingsToStorage(normalized);

  const baseState = ensureCustomerServiceV2State(cs);
  const nextState: CustomerServiceV2State = {
    ...baseState,
    settings: normalized,
  };

  return updateTabState(
    global,
    {
      customerServiceV2: nextState,
    },
    tabId,
  );
});

addActionHandler('exportCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const settings = selectCustomerServiceV2Settings(global, tabId);

  if (!settings) {
    return global;
  }

  const exportData = {
    version: '2.0',
    timestamp: new Date().toISOString(),
    settings,
  };

  const blob = new Blob([JSON.stringify(exportData, undefined, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `customer-service-v2-settings-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return global;
});

addActionHandler('importCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { fileContent, tabId = getCurrentTabId() } = payload;

  try {
    const parsed = JSON.parse(fileContent);
    const candidate = parsed?.settings ?? parsed;

    if (!candidate) {
      throw new Error('Missing settings');
    }

    const normalized = normalizeSettingsForSave(candidate);

    actions.saveCustomerServiceV2Settings({ settings: normalized, tabId });
  } catch (error) {
    // Ignore malformed input
  }

  return global;
});
