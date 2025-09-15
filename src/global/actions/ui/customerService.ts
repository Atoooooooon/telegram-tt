import type { ActionReturnType } from '../../types';
import type { ApiMessage } from '../../../api/types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { addActionHandler, getGlobal } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectTabState, selectChat } from '../../selectors';
import { CUSTOMER_SERVICE_CONFIG } from '../../../config/customerService';
import { callApi } from '../../../api/gramjs';

// 客服设置在localStorage中的key
const CUSTOMER_SERVICE_SETTINGS_KEY = 'customerServiceSettings';

// 保存客服设置到localStorage
function saveSettingsToStorage(settings: any) {
  try {
    localStorage.setItem(CUSTOMER_SERVICE_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save customer service settings:', error);
  }
}

// 从 localStorage 加载客服设置
export function loadSettingsFromStorage() {
  try {
    const stored = localStorage.getItem(CUSTOMER_SERVICE_SETTINGS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.warn('Failed to load customer service settings:', error);
    return null;
  }
}

addActionHandler('toggleCustomerService', (global, actions, payload): ActionReturnType => {
  const { force, tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  const isCustomerServiceModalOpen = force !== undefined 
    ? force 
    : !tabState.isCustomerServiceModalOpen;

  return updateTabState(global, {
    isCustomerServiceModalOpen,
  }, tabId);
});

addActionHandler('openCustomerService', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  return updateTabState(global, {
    isCustomerServiceModalOpen: true,
  }, tabId);
});

// 添加一个新的action来初始化客服设置
addActionHandler('initializeCustomerServiceSettings', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService;

  // 只在没有设置时才初始化
  if (!currentCustomerService?.settings) {
    const savedSettings = loadSettingsFromStorage();
    if (savedSettings) {
      return updateTabState(global, {
        customerService: {
          ...currentCustomerService,
          messages: currentCustomerService?.messages || [],
          messagesByChatId: currentCustomerService?.messagesByChatId || {},
          lastUpdated: currentCustomerService?.lastUpdated || Date.now(),
          repliedMessageIds: currentCustomerService?.repliedMessageIds || [],
          settings: savedSettings,
        },
      }, tabId);
    }
  }

  return global;
});

addActionHandler('closeCustomerService', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  // 清除客服回复状态
  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService;
  
  global = updateTabState(global, {
    isCustomerServiceModalOpen: false,
    customerService: currentCustomerService ? {
      ...currentCustomerService,
      replyingToMessage: undefined,
    } : undefined,
  }, tabId);

  // 清除draft回复信息
  actions.resetDraftReplyInfo({ tabId });

  return global;
});

addActionHandler('addToCustomerService', (global, actions, payload): ActionReturnType => {
  const { message, chatId, tabId = getCurrentTabId() } = payload as {
    message: ApiMessage;
    chatId: string;
    tabId?: number;
  };

  const tabState = selectTabState(global, tabId);
  const currentTime = Date.now();
  
  // 初始化客服状态
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: currentTime,
    repliedMessageIds: [],
  };

  // 添加消息到总列表
  const newMessages = [...currentCustomerService.messages, message]
    .sort((a, b) => (b.date || 0) - (a.date || 0)) // 按时间倒序
    .slice(0, CUSTOMER_SERVICE_CONFIG.MAX_MESSAGES_DISPLAY); // 限制数量

  // 添加消息到按chatId分组的列表
  const currentChatMessages = currentCustomerService.messagesByChatId[chatId] || [];
  const newChatMessages = [...currentChatMessages, message]
    .sort((a, b) => (b.date || 0) - (a.date || 0))
    .slice(0, CUSTOMER_SERVICE_CONFIG.MAX_MESSAGES_DISPLAY);

  const updatedCustomerService = {
    ...currentCustomerService, // 保留所有现有状态
    messages: newMessages,
    messagesByChatId: {
      ...currentCustomerService.messagesByChatId,
      [chatId]: newChatMessages,
    },
    lastUpdated: currentTime,
  };

  return updateTabState(global, {
    customerService: updatedCustomerService,
  }, tabId);
});

addActionHandler('clearCustomerServiceMessages', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};

  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService;

  // 标记每个相关聊天中的特定消息为已读
  if (currentCustomerService?.messagesByChatId) {
    Object.entries(currentCustomerService.messagesByChatId).forEach(([chatId, messages]) => {
      if (messages && messages.length > 0) {
        const chat = selectChat(global, chatId);
        if (chat) {
          // 找到该聊天中最新的消息ID
          const maxMessageId = Math.max(...messages.map(msg => msg.id));
          callApi('markMessageListRead', {
            chat,
            threadId: MAIN_THREAD_ID,
            maxId: maxMessageId
          });
        }
      }
    });
  }

  return updateTabState(global, {
    customerService: {
      messages: [],
      messagesByChatId: {},
      lastUpdated: Date.now(),
      repliedMessageIds: [],
    },
  }, tabId);
});

addActionHandler('setCustomerServiceReply', (global, actions, payload): ActionReturnType => {
  const { message, tabId = getCurrentTabId() } = payload as {
    message?: ApiMessage;
    tabId?: number;
  };

  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: Date.now(),
    repliedMessageIds: [],
  };

  return updateTabState(global, {
    customerService: {
      ...currentCustomerService,
      replyingToMessage: message,
    },
  }, tabId);
});

addActionHandler('sendCustomerServiceReply', (global, actions, payload): ActionReturnType => {
  const { text, replyToMessage, tabId = getCurrentTabId() } = payload as {
    text: string;
    replyToMessage: ApiMessage;
    tabId?: number;
  };

  if (!text.trim() || !replyToMessage) {
    return global;
  }

  // 发送消息到原始群组
  actions.sendMessage({
    text,
    chatId: replyToMessage.chatId,
    replyInfo: {
      replyToMsgId: replyToMessage.id,
      // 不设置 replyToPeerId，让它在同一个群组内正常回复
    },
  });

  // 清除回复状态和draft信息
  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: Date.now(),
    repliedMessageIds: [],
  };

  // 使用新的action来标记消息已回复
  actions.markCustomerServiceMessageReplied({
    chatId: replyToMessage.chatId,
    messageId: replyToMessage.id,
    tabId,
  });

  // 清除客服回复状态
  global = getGlobal();
  const updatedTabState = selectTabState(global, tabId);
  const updatedCustomerService = updatedTabState.customerService || currentCustomerService;
  
  global = updateTabState(global, {
    customerService: {
      ...updatedCustomerService,
      replyingToMessage: undefined,
    },
  }, tabId);

  // 清除draft回复信息
  actions.resetDraftReplyInfo({ tabId });

  return global;
});

addActionHandler('resolveCustomerServiceMessage', (global, actions, payload): ActionReturnType => {
  const { message, tabId = getCurrentTabId() } = payload as {
    message: ApiMessage;
    tabId?: number;
  };

  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: Date.now(),
    repliedMessageIds: [],
  };

  // 从总消息列表中移除该消息
  const newMessages = currentCustomerService.messages.filter(
    msg => !(msg.id === message.id && msg.chatId === message.chatId)
  );

  // 从按chatId分组的消息中移除该消息
  const newMessagesByChatId = { ...currentCustomerService.messagesByChatId };
  const chatMessages = newMessagesByChatId[message.chatId] || [];
  newMessagesByChatId[message.chatId] = chatMessages.filter(
    msg => msg.id !== message.id
  );

  // 如果该群组没有消息了，删除整个键
  if (newMessagesByChatId[message.chatId].length === 0) {
    delete newMessagesByChatId[message.chatId];
  }

  const updatedCustomerService = {
    ...currentCustomerService,
    messages: newMessages,
    messagesByChatId: newMessagesByChatId,
    lastUpdated: Date.now(),
    // 如果正在回复的消息被解决了，也清除回复状态
    replyingToMessage: currentCustomerService.replyingToMessage?.id === message.id &&
                      currentCustomerService.replyingToMessage?.chatId === message.chatId
                      ? undefined
                      : currentCustomerService.replyingToMessage,
  };

  global = updateTabState(global, {
    customerService: updatedCustomerService,
  }, tabId);

  // 如果解决的消息正是当前回复的消息，也清除draft回复信息
  if (currentCustomerService.replyingToMessage?.id === message.id &&
      currentCustomerService.replyingToMessage?.chatId === message.chatId) {
    actions.resetDraftReplyInfo({ tabId });
  }

  // 标记该特定消息为已读（只会影响该消息ID及之前的消息）
  const chat = selectChat(global, message.chatId);
  if (chat) {
    callApi('markMessageListRead', {
      chat,
      threadId: MAIN_THREAD_ID,
      maxId: message.id
    });
  }

  return global;
});

addActionHandler('markCustomerServiceMessageReplied', (global, actions, payload): ActionReturnType => {
  const { chatId, messageId, tabId = getCurrentTabId() } = payload as {
    chatId: string;
    messageId: number;
    tabId?: number;
  };

  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: Date.now(),
    repliedMessageIds: [],
  };

  // 记录已回复的消息ID
  const messageKey = `${chatId}-${messageId}`;
  const currentRepliedIds = Array.isArray(currentCustomerService.repliedMessageIds) 
    ? currentCustomerService.repliedMessageIds 
    : [];
  const newRepliedMessageIds = [...currentRepliedIds];
  if (!newRepliedMessageIds.includes(messageKey)) {
    newRepliedMessageIds.push(messageKey);
  }

  return updateTabState(global, {
    customerService: {
      ...currentCustomerService,
      repliedMessageIds: newRepliedMessageIds,
    },
  }, tabId);
});

addActionHandler('saveCustomerServiceSettings', (global, actions, payload): ActionReturnType => {
  const { settings, tabId = getCurrentTabId() } = payload as {
    settings: {
      monitoredChatIds: string[];
      filteredUserIds: string[];
      regexFilters: RegExp[];
    };
    tabId?: number;
  };

  const tabState = selectTabState(global, tabId);
  const currentCustomerService = tabState.customerService || {
    messages: [],
    messagesByChatId: {},
    lastUpdated: Date.now(),
    repliedMessageIds: [],
  };

  const settingsToSave = {
    monitoredChatIds: settings.monitoredChatIds || [],
    filteredUserIds: settings.filteredUserIds || [],
    regexFilters: (settings.regexFilters || []).map(regex => ({
      source: regex.source,
      flags: regex.flags,
    })),
  };

  // 保存到 localStorage
  saveSettingsToStorage(settingsToSave);

  return updateTabState(global, {
    customerService: {
      ...currentCustomerService,
      settings: settingsToSave,
    },
  }, tabId);
});