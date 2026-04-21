/**
 * Customer Service V2 - Settings and UI Control
 *
 * This file handles:
 * - Settings initialization, save, import/export
 * - UI control (open/close settings panel)
 * - Quick reply functionality
 * - Mode toggle and context management
 * - Paused chats management (assist mode)
 *
 * Related modules:
 * - customerServiceV2Messages.ts - Message CRUD operations
 * - customerServiceV2Cloud.ts - Cloud sync functionality
 * - customerServiceV2Helpers.ts - Shared utilities
 */

// Import side-effect modules to register their action handlers
import './customerServiceV2Cloud';
import './customerServiceV2Messages';

import type { RequiredGlobalActions } from '../../index';
import type { ActionReturnType } from '../../types';
import type { CustomerServiceSettings } from '../../types/customerServiceV2';

import { EDITABLE_INPUT_ID } from '../../../config';
import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getTranslationFn } from '../../../util/localization';
import { loadCustomerServiceCloudSyncPreference } from '../../helpers/customerServiceCloudSyncPreference';
import {
  loadCustomerServiceV2SettingsFromStorage,
  normalizeCustomerServiceQuickReplies,
  saveCustomerServiceV2SettingsToStorage,
} from '../../helpers/customerServiceV2Settings';
import { addActionHandler } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectChat, selectCurrentMessageList } from '../../selectors';
import { selectCustomerServiceV2Settings } from '../../selectors/customerServiceV2';
import {
  ensureCustomerServiceV2State,
  getDefaultCustomerServiceV2Settings,
  normalizeSettingsForSave,
  ownersMatch,
  pauseCustomerServiceChat,
  updateCustomerServiceV2State,
} from './customerServiceV2Helpers';

let isCheckingPausedChatsStatus = false;

function uploadCustomerServiceSettingsToCloudIfOwner(
  actions: RequiredGlobalActions,
  global: { currentUserId?: string | number },
  settings: CustomerServiceSettings,
  tabId: number,
) {
  const preference = loadCustomerServiceCloudSyncPreference();
  const token = preference?.token?.trim();
  const currentUserId = global.currentUserId ? String(global.currentUserId) : undefined;
  const ownerId = preference?.ownerId;

  if (!token || !currentUserId || !ownerId || !ownersMatch(ownerId, currentUserId)) {
    return;
  }

  const lang = getTranslationFn();
  void actions.syncCustomerServiceV2Cloud({
    tabId,
    token,
    operation: 'upload',
    localSettings: settings,
    onUpload: (result) => {
      actions.showNotification({
        message: lang('CustomerServiceCloudSyncUploadSuccessVersion', {
          version: String(result?.version ?? 1),
        }),
        tabId,
      });
    },
    onError: () => {
      actions.showNotification({
        message: lang('CustomerServiceCloudSyncFailed'),
        tabId,
      });
    },
  });
}

/**
 * Set current context for customer service message
 * Used to highlight the currently focused message in the message list
 */
addActionHandler('setCustomerServiceV2Context', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload;

  return updateTabState(
    global,
    { customerServiceV2Context: { currentContextChatId: chatId, currentContextMessageId: messageId } },
    tabId,
  );
});

/**
 * Pause chat in assist mode
 */
addActionHandler('pauseCustomerServiceV2Chat', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId } = payload;

  return pauseCustomerServiceChat(global, chatId, messageId);
});

/**
 * Resume chat in assist mode
 */
addActionHandler('resumeCustomerServiceV2Chat', (global, actions, payload): ActionReturnType => {
  const { chatId } = payload;

  const cs = ensureCustomerServiceV2State(global.customerServiceV2);
  const pausedChats = { ...(cs.pausedChats || {}) };
  delete pausedChats[chatId];

  return updateCustomerServiceV2State(global, { ...cs, pausedChats });
});

/**
 * Initialize Customer Service V2 state
 * Called on app init
 */
addActionHandler('initCustomerServiceV2', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  if (!global.customerServiceV2) {
    const settings = loadCustomerServiceV2SettingsFromStorage() || undefined;

    void actions.autoSyncCustomerServiceV2Cloud({ tabId });
    setTimeout(() => {
      void actions.autoSyncCustomerServiceV2Cloud({ tabId });
    }, 2000);

    return {
      ...global,
      customerServiceV2: {
        messages: [],
        messagesByChatId: {},
        lastSyncTimestamp: Date.now(),
        messageCount: 0,
        settings,
      },
    };
  }

  return global;
});

addActionHandler('initializeCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  if (global.customerServiceV2?.settings) {
    return global;
  }

  const storedSettings = loadCustomerServiceV2SettingsFromStorage();
  if (!storedSettings) {
    return global;
  }

  return updateCustomerServiceV2State(global, {
    ...ensureCustomerServiceV2State(global.customerServiceV2),
    settings: storedSettings,
  });
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

    // Direct-send quick replies should behave like normal send:
    // clear current draft (text + reply) after sending.
    actions.clearDraft({
      chatId: messageListDescriptor.chatId,
      threadId: messageListDescriptor.threadId,
      isLocalOnly: true,
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
  const cs = ensureCustomerServiceV2State(global.customerServiceV2);

  const existingSettings = cs.settings
    || loadCustomerServiceV2SettingsFromStorage()
    || getDefaultCustomerServiceV2Settings();

  const nextMode: CustomerServiceSettings['mode'] = existingSettings.mode === 'assist' ? 'oncall' : 'assist';

  const normalized = normalizeSettingsForSave({
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
    rules: existingSettings.rules,
    oncall: existingSettings.oncall,
  });
  saveCustomerServiceV2SettingsToStorage(normalized);

  const nextGlobal = updateCustomerServiceV2State(global, {
    ...cs,
    settings: normalized,
    pausedChats: nextMode === 'assist' ? cs.pausedChats : undefined,
  });

  uploadCustomerServiceSettingsToCloudIfOwner(actions, nextGlobal, normalized, tabId);

  return nextGlobal;
});

addActionHandler('checkPausedChatsStatusV2', (global, actions, payload): ActionReturnType => {
  if (isCheckingPausedChatsStatus) {
    return global;
  }

  const cs = global.customerServiceV2;
  if (!cs?.pausedChats || cs.settings?.mode !== 'assist') {
    return global;
  }

  isCheckingPausedChatsStatus = true;

  try {
    const updatedPausedChats = { ...cs.pausedChats };
    let hasChanges = false;

    for (const chatId of Object.keys(cs.pausedChats)) {
      const pauseInfo = cs.pausedChats[chatId];

      if (!pauseInfo?.lastMessageId) {
        delete updatedPausedChats[chatId];
        hasChanges = true;
        continue;
      }

      const chat = selectChat(global, chatId);
      if (!chat) {
        continue;
      }

      const isRead = Boolean(
        chat.lastReadInboxMessageId && chat.lastReadInboxMessageId >= pauseInfo.lastMessageId,
      );
      const hasUnread = chat.unreadCount && chat.unreadCount > 0;

      if (isRead || !hasUnread) {
        delete updatedPausedChats[chatId];
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return global;
    }

    return updateCustomerServiceV2State(global, {
      ...cs,
      pausedChats: Object.keys(updatedPausedChats).length ? updatedPausedChats : undefined,
    });
  } finally {
    isCheckingPausedChatsStatus = false;
  }
});

addActionHandler('saveCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const { settings, tabId = getCurrentTabId() } = payload;

  const normalized = normalizeSettingsForSave(settings);
  saveCustomerServiceV2SettingsToStorage(normalized);

  const nextGlobal = updateCustomerServiceV2State(global, {
    ...ensureCustomerServiceV2State(global.customerServiceV2),
    settings: normalized,
  });

  uploadCustomerServiceSettingsToCloudIfOwner(actions, nextGlobal, normalized, tabId);

  return nextGlobal;
});

addActionHandler('exportCustomerServiceV2Settings', (global, actions, payload): ActionReturnType => {
  const settings = selectCustomerServiceV2Settings(global);

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
