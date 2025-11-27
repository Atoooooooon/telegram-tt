import type { ActionReturnType } from '../../types';
import type { ApiMessage } from '../../../api/types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { addActionHandler, getGlobal } from '../../index';
import { updateTabState } from '../../reducers/tabs';
import { selectTabState, selectChat, selectCurrentChat } from '../../selectors';
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

  // 检查当前模式，只在辅助模式下启动定期检查
  const tabState = selectTabState(global, tabId);
  const customerService = tabState.customerService;
  const isAssistMode = customerService?.settings?.mode === 'assist';

  if (isAssistMode) {
    // 开启客服模块时，启动定期检查暂停聊天状态
    const checkInterval = setInterval(() => {
      actions.checkPausedChatsStatus({ tabId });
    }, 10000); // 每10秒检查一次，更频繁地检查

    // 将定时器ID保存到全局状态中（简单实现，可以优化）
    (globalThis as any).customerServiceCheckInterval = checkInterval;
    console.log("Started paused chats monitoring (assist mode) - checking every 10 seconds");
  } else {
    console.log("Running in oncall mode, no chat monitoring pause");
  }

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

  // 清除定时器
  const checkInterval = (globalThis as any).customerServiceCheckInterval;
  if (checkInterval) {
    clearInterval(checkInterval);
    delete (globalThis as any).customerServiceCheckInterval;
  }

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
    pausedChats: {}, // 暂停监听的聊天 { chatId: { pausedAt: timestamp, lastMessageId: number } }
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

  // 检查当前模式是否启用辅助模式的暂停监听功能
  const customerSettings = currentCustomerService.settings;
  const isAssistMode = customerSettings?.mode === 'assist';

  const updatedCustomerService = {
    ...currentCustomerService, // 保留所有现有状态
    messages: newMessages,
    messagesByChatId: {
      ...currentCustomerService.messagesByChatId,
      [chatId]: newChatMessages,
    },
    lastUpdated: currentTime,
    // 只在辅助模式下暂停该聊天的监听，等待人工处理
    ...(isAssistMode && {
      pausedChats: {
        ...currentCustomerService.pausedChats,
        [chatId]: {
          pausedAt: currentTime,
          lastMessageId: message.id,
          lastMessage: message, // 保存消息引用用于后续检查
        },
      },
    }),
  };

  console.log("Customer service mode:", isAssistMode ? 'assist' : 'oncall',
              "Chat monitoring:", isAssistMode ? 'paused' : 'continue');

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
    let apiCallsCount = 0;
    const totalApiCalls = Object.keys(currentCustomerService.messagesByChatId).length;

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
          }).then(() => {
            apiCallsCount++;
            // 当所有API调用完成后，检查暂停聊天状态
            if (apiCallsCount === totalApiCalls) {
              setTimeout(() => {
                actions.checkPausedChatsStatus({ tabId });
              }, 1000);
            }
          });
        }
      }
    });
  }

  return updateTabState(global, {
    customerService: {
      ...currentCustomerService,
      messages: [],
      messagesByChatId: {},
      lastUpdated: Date.now(),
      repliedMessageIds: [],
      // 保留重要状态：settings、pausedChats等
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

  // 标记该特定消息为已读（使用 ReadHistory API）
  const chat = selectChat(global, message.chatId);
  if (chat) {

    // 对于文本消息，使用 markMessageListRead 来标记已读
    // 这会标记到该消息ID为止的所有消息为已读（这是Telegram的标准行为）
    console.log("Using markMessageListRead for text message, unreadCount:", chat.unreadCount);
    callApi('markMessageListRead', {
      chat,
      threadId: MAIN_THREAD_ID,
      maxId: message.id
    })
      .then(() => {
        console.log("markMessageListRead API call successful for message:", message.id);
        // 在API调用成功后，延迟检查暂停聊天状态以恢复监听
        setTimeout(() => {
          actions.checkPausedChatsStatus({ tabId: getCurrentTabId() });
        }, 1000); // 给服务器一些时间更新状态
      })
      .catch((error) => {
        console.error("markMessageListRead API call failed:", error);
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

// 检查暂停聊天的消息状态并决定是否恢复监听
addActionHandler('checkPausedChatsStatus', (global, actions, payload): ActionReturnType => {
  const { tabId = getCurrentTabId() } = payload || {};
  const tabState = selectTabState(global, tabId);
  const customerService = tabState.customerService;

  console.log("🔍 checkPausedChatsStatus called, customerService mode:", customerService?.settings?.mode);

  if (!customerService?.pausedChats) {
    console.log("❌ No paused chats to check");
    return global;
  }

  const pausedChatIds = Object.keys(customerService.pausedChats);
  console.log("📋 Checking", pausedChatIds.length, "paused chats:", pausedChatIds);

  const updatedPausedChats = { ...customerService.pausedChats };
  let hasChanges = false;

  Object.entries(customerService.pausedChats).forEach(([chatId, pauseInfo]) => {
    const { lastMessage, lastMessageId } = pauseInfo;
    const chat = selectChat(global, chatId);

    if (!chat) {
      console.log("❌ Chat not found:", chatId);
      return;
    }

    const messageId = lastMessageId || lastMessage?.id;
    if (!messageId) {
      console.log("❌ No message ID found for paused chat:", chatId);
      return;
    }

    console.log("🔍 Checking paused chat:", chatId,
                "pausedMessageId:", messageId,
                "chat.lastReadInboxMessageId:", chat.lastReadInboxMessageId,
                "chat.unreadCount:", chat.unreadCount);

    // 检查消息是否已读或已回复
    const messageKey = `${chatId}-${messageId}`;
    const isReplied = customerService.repliedMessageIds?.includes(messageKey);

    // 多种方式检查消息是否已读：
    // 1. 比较消息ID和聊天的lastReadInboxMessageId（主要方法）
    const isReadByMessageId = chat.lastReadInboxMessageId && messageId <= chat.lastReadInboxMessageId;

    // 2. 检查聊天的未读计数（辅助方法）
    const isReadByUnreadCount = chat.unreadCount === 0;

    // 3. 检查消息本身的已读状态（备用方法）
    const isReadByMessageState = lastMessage && !lastMessage.isMediaUnread && !lastMessage.hasUnreadMention;

    const isRead = isReadByMessageId || (isReadByUnreadCount && isReadByMessageState);

    console.log("📊 Read status checks for chat", chatId, ":", {
      messageId,
      chatLastReadId: chat.lastReadInboxMessageId,
      isReadByMessageId,
      isReadByUnreadCount,
      isReadByMessageState,
      isReplied,
      finalIsRead: isRead
    });

    if (isRead || isReplied) {
      console.log("✅ Message processed, resuming monitoring for chat:", chatId);

      // 恢复监听该聊天
      delete updatedPausedChats[chatId];
      hasChanges = true;
    } else {
      console.log("⏸️ Message still pending, keeping chat paused:", chatId);
    }
  });

  if (hasChanges) {
    return updateTabState(global, {
      customerService: {
        ...customerService,
        pausedChats: updatedPausedChats,
      },
    }, tabId);
  }

  return global;
});

addActionHandler('saveCustomerServiceSettings', (global, actions, payload): ActionReturnType => {
  const { settings, tabId = getCurrentTabId() } = payload as {
    settings: {
      monitoredChatIds: string[];
      filteredUserIds: string[];
      regexFilters: RegExp[];
      autoRead?: boolean; // 添加自动已读选项
      mode?: 'oncall' | 'assist'; // 添加模式选择：oncall全力模式 | assist辅助模式
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
    autoRead: settings.autoRead || false, // 保存自动已读设置
    mode: settings.mode || 'oncall', // 保存模式设置，默认为oncall模式
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