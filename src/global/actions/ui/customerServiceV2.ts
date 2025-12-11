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

import type { ActionReturnType } from '../../types';
import type { CustomerServiceSettings, CustomerServiceV2State } from '../../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { EDITABLE_INPUT_ID } from '../../../config';
import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getTranslationFn } from '../../../util/localization';
import {
  loadCustomerServiceV2SettingsFromStorage,
  normalizeCustomerServiceQuickReplies,
  saveCustomerServiceV2SettingsToStorage,
} from '../../helpers/customerServiceV2Settings';
import { loadCustomerServiceCloudSyncPreference } from '../../helpers/customerServiceCloudSyncPreference';
import { addActionHandler } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectChat, selectCurrentMessageList, selectTabState } from '../../selectors';
import {
  selectCustomerServiceV2Settings,
  selectCustomerServiceV2State,
} from '../../selectors/customerServiceV2';

import {
  ensureCustomerServiceV2State,
  getDefaultCustomerServiceV2Settings,
  normalizeSettingsForSave,
  pauseCustomerServiceChat,
  ownersMatch,
  syncCustomerServiceV2StateAcrossTabs,
} from './customerServiceV2Helpers';

// Import side-effect modules to register their action handlers
import './customerServiceV2Messages';
import './customerServiceV2Cloud';

let hasScheduledCustomerServiceAutoCloudSync = false;
let isCheckingPausedChatsStatus = false;

/**
 * Set current context for customer service message
 * Used to highlight the currently focused message in the message list
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
  const { chatId, messageId } = payload;

  return pauseCustomerServiceChat(global, chatId, messageId);
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

  return syncCustomerServiceV2StateAcrossTabs(global, nextState);
});

/**
 * Initialize Customer Service V2 state
 * Called on app init
 */
addActionHandler('initCustomerServiceV2', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const tabState = selectTabState(global, tabId);

  if (!hasScheduledCustomerServiceAutoCloudSync) {
    hasScheduledCustomerServiceAutoCloudSync = true;
    void actions.autoSyncCustomerServiceV2Cloud({ tabId });
    // Run auto-sync again shortly after initial boot to ensure state/user data is ready
    setTimeout(() => {
      void actions.autoSyncCustomerServiceV2Cloud({ tabId });
    }, 2000);
  }

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
    rules: existingSettings.rules,
    ruleEngineConfig: existingSettings.ruleEngineConfig,
  };

  const normalized = normalizeSettingsForSave(updatedSettings);
  saveCustomerServiceV2SettingsToStorage(normalized);

  const nextState: CustomerServiceV2State = {
    ...baseState,
    settings: normalized,
    pausedChats: nextMode === 'assist' ? baseState.pausedChats : undefined,
  };

  return syncCustomerServiceV2StateAcrossTabs(global, nextState);
});

addActionHandler('checkPausedChatsStatusV2', (global, actions, payload): ActionReturnType => {
  // Prevent re-entry to avoid infinite recursion
  if (isCheckingPausedChatsStatus) {
    return global;
  }

  const { tabId = getCurrentTabId() } = payload || {};
  const cs = selectCustomerServiceV2State(global, tabId);

  if (!cs?.pausedChats || !cs.settings || cs.settings.mode !== 'assist') {
    return global;
  }

  isCheckingPausedChatsStatus = true;

  try {
    const updatedPausedChats = { ...cs.pausedChats };
    let hasChanges = false;
    const pausedChatIds = Object.keys(cs.pausedChats);

    for (let i = 0; i < pausedChatIds.length; i += 1) {
      const chatId = pausedChatIds[i];
      const pauseInfo = cs.pausedChats[chatId];

      if (!pauseInfo) {
        delete updatedPausedChats[chatId];
        hasChanges = true;
        continue;
      }

      const chat = selectChat(global, chatId);
      if (!chat) {
        continue;
      }

      const lastTrackedMessageId = pauseInfo.lastMessageId;
      if (!lastTrackedMessageId) {
        delete updatedPausedChats[chatId];
        hasChanges = true;
        continue;
      }

      const isRead = Boolean(chat.lastReadInboxMessageId && chat.lastReadInboxMessageId >= lastTrackedMessageId);
      const hasUnread = chat.unreadCount && chat.unreadCount > 0;

      if (isRead || !hasUnread) {
        delete updatedPausedChats[chatId];
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return global;
    }

    const nextState: CustomerServiceV2State = {
      ...cs,
      pausedChats: Object.keys(updatedPausedChats).length ? updatedPausedChats : undefined,
    };

    // Use updateTabState directly to avoid triggering cross-tab sync
    // which would cause infinite recursion through apiUpdaters
    return updateTabState(global, { customerServiceV2: nextState }, tabId);
  } finally {
    isCheckingPausedChatsStatus = false;
  }
});

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

  const nextGlobal = syncCustomerServiceV2StateAcrossTabs(global, nextState);

  // After saving locally, if current user is the owner of a managed cloud token,
  // upload the latest settings in the background.
  const preference = loadCustomerServiceCloudSyncPreference();
  const token = preference?.token?.trim();
  const currentUserId = nextGlobal.currentUserId ? String(nextGlobal.currentUserId) : undefined;
  const ownerId = preference?.ownerId;

  if (token && currentUserId && ownerId && ownersMatch(ownerId, currentUserId)) {
    const lang = getTranslationFn();
    void actions.syncCustomerServiceV2Cloud({
      tabId,
      token,
      operation: 'upload',
      localSettings: normalized,
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

  return nextGlobal;
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
