/**
 * Action capabilities
 * Capabilities that perform actions (mark read, auto reply, etc.)
 */

import type { Capability } from '../../types/customerServiceV2';
import { MAIN_THREAD_ID } from '../../../api/types';

import { renderTemplate } from '../templateRenderer';

const MIN_TYPING_DELAY_MS = 900;
const MAX_TYPING_DELAY_MS = 1800;

function waitFor(ms: number): Promise<void> {
  if (!ms || ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveTypingDelayMs(configuredDelay?: number): number {
  if (typeof configuredDelay === 'number' && Number.isFinite(configuredDelay)) {
    return Math.max(0, configuredDelay);
  }

  return MIN_TYPING_DELAY_MS
    + Math.floor(Math.random() * (MAX_TYPING_DELAY_MS - MIN_TYPING_DELAY_MS));
}

/**
 * Mark message as read in Telegram
 */
export const actionMarkReadCapability: Capability = {
  id: 'action_mark_read',
  name: '标记为已读',
  type: 'action',
  description: '标记 Telegram 消息为已读',

  configSchema: {
    targetMessage: {
      type: 'select',
      label: '标记目标',
      options: ['当前消息', '回复的原消息'],
      default: '回复的原消息',
    },
    maxUnreadCount: {
      type: 'number',
      label: '最大已读条数',
      default: 1,
    },
  },

  async execute({ message, config, global }) {
    const { targetMessage = '回复的原消息', maxUnreadCount = 1 } = config;

    let targetId: number;
    if (targetMessage === '当前消息') {
      targetId = message.id;
    } else {
      const { getMessageReplyInfo } = await import('../replies');
      const replyInfo = getMessageReplyInfo(message);
      const replyToId = replyInfo?.replyToMsgId;

      if (!replyToId) {
        return {
          success: false,
          error: 'Message is not a reply, cannot find original message',
        };
      }
      targetId = replyToId;
    }

    try {
      const { callApi } = await import('../../../api/gramjs');
      const { selectChat, selectChatMessages } = await import('../../selectors');

      const chat = selectChat(global, message.chatId);
      if (!chat) {
        return {
          success: false,
          error: 'Chat not found',
        };
      }

      const threadId = (message as { threadId?: number }).threadId ?? MAIN_THREAD_ID;

      // Check unread count before marking as read
      const lastReadInboxMessageId = chat.lastReadInboxMessageId || 0;
      const messages = selectChatMessages(global, message.chatId);

      // Count unread messages between lastReadInboxMessageId and targetId
      let unreadCount = 0;
      if (messages) {
        const messageIds = Object.keys(messages).map(Number).sort((a, b) => a - b);
        for (const msgId of messageIds) {
          if (msgId > lastReadInboxMessageId && msgId <= targetId) {
            const msg = messages[msgId];
            if (msg && !msg.isOutgoing) {
              unreadCount += 1;
            }
          }
        }
      }

      // If unread count exceeds maxUnreadCount, abort
      if (unreadCount > maxUnreadCount) {
        return {
          success: false,
          error: `Prevented batch read: ${unreadCount} messages would be marked as read, exceeds maxUnreadCount (${maxUnreadCount}).`,
        };
      }

      // Mark message as read in Telegram
      await callApi('markMessageListRead', {
        chat,
        threadId,
        maxId: targetId,
      });

      return {
        success: true,
        data: {
          markedMessageId: targetId,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to mark as read: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Send auto reply
 */
export const actionAutoReplyCapability: Capability = {
  id: 'action_auto_reply',
  name: '自动回复',
  type: 'action',
  description: '发送自动回复消息',

  configSchema: {
    template: {
      type: 'textarea',
      label: '回复模板',
      placeholder: '支持 {{变量}} 语法',
      required: true,
    },
    replyToOriginal: {
      type: 'boolean',
      label: '回复原消息',
      default: true,
    },
    typingDelayMs: {
      type: 'number',
      label: '输入延迟(毫秒)',
      placeholder: '默认 900-1800 范围随机',
    },
  },

  async execute({ message, config, pipelineData, global }) {
    const { template, replyToOriginal = true, typingDelayMs } = config;

    if (!template) {
      return {
        success: false,
        error: 'Template is required',
      };
    }

    // Render template with pipeline data
    const replyText = renderTemplate(template, pipelineData);

    try {
      const { callApi } = await import('../../../api/gramjs');
      const { selectChat } = await import('../../selectors');

      const chat = selectChat(global, message.chatId);
      if (!chat) {
        return {
          success: false,
          error: 'Chat not found',
        };
      }

      const threadId = (message as { threadId?: number }).threadId ?? MAIN_THREAD_ID;
      const delayMs = resolveTypingDelayMs(typingDelayMs);
      let typingActionActive = false;

      try {
        await callApi('markMessageListRead', {
          chat,
          threadId,
          maxId: message.id,
        });
      } catch (markReadError) {
        console.error('[RuleEngine] Auto reply mark read failed:', markReadError);
      }

      if (delayMs > 0) {
        try {
          await callApi('sendMessageAction', {
            peer: chat,
            threadId,
            action: { type: 'typing' },
          });
          typingActionActive = true;
        } catch (typingError) {
          console.error('[RuleEngine] Typing indicator failed:', typingError);
        }

        await waitFor(delayMs);
      }

      await callApi('sendMessage', {
        chat,
        text: replyText,
        replyInfo: replyToOriginal ? {
          type: 'message',
          replyToMsgId: message.id,
        } : undefined,
      });

      if (typingActionActive) {
        callApi('sendMessageAction', {
          peer: chat,
          threadId,
          action: { type: 'cancel' },
        }).catch((cancelError) => {
          console.error('[RuleEngine] Typing cancel failed:', cancelError);
        });
      }

      return {
        success: true,
        data: {
          repliedText: replyText,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send reply: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Add message to customer service queue
 */
export const actionAddQueueCapability: Capability = {
  id: 'action_add_queue',
  name: '添加到客服队列',
  type: 'action',
  description: '添加消息到客服队列',

  configSchema: {},

  async execute({ message, actions }) {
    try {
      await actions.addToCustomerServiceV2({
        message,
        chatId: message.chatId,
      });

      return {
        success: true,
        data: {
          addedToQueue: true,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to add to queue: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Forward message to another chat
 */
export const actionForwardCapability: Capability = {
  id: 'action_forward',
  name: '转发消息',
  type: 'action',
  description: '转发消息到指定聊天窗口',

  configSchema: {
    toChatId: {
      type: 'string',
      label: '目标聊天ID',
      required: true,
      placeholder: '输入目标聊天的ID',
    },
    dropAuthor: {
      type: 'boolean',
      label: '隐藏原作者',
      default: false,
    },
    dropCaption: {
      type: 'boolean',
      label: '删除原标题',
      default: false,
    },
  },

  async execute({ message, config, global }) {
    const { toChatId, dropAuthor = false, dropCaption = false } = config;

    if (!toChatId) {
      return {
        success: false,
        error: 'Target chat ID is required',
      };
    }

    try {
      const { callApi } = await import('../../../api/gramjs');
      const { selectChat } = await import('../../selectors');

      const fromChat = selectChat(global, message.chatId);
      const toChat = selectChat(global, toChatId);

      if (!fromChat) {
        return {
          success: false,
          error: 'Source chat not found',
        };
      }

      if (!toChat) {
        return {
          success: false,
          error: 'Target chat not found',
        };
      }

      const threadId = (message as { threadId?: number }).threadId ?? MAIN_THREAD_ID;

      // Mark message as read before forwarding (simulate real user behavior)
      try {
        await callApi('markMessageListRead', {
          chat: fromChat,
          threadId,
          maxId: message.id,
        });
      } catch (markReadError) {
        console.error('[RuleEngine] Forward mark read failed:', markReadError);
        // Continue even if mark read fails
      }

      await callApi('forwardMessages', {
        fromChat,
        toChat,
        messages: [message],
        noAuthors: dropAuthor,
        noCaptions: dropCaption,
      });

      return {
        success: true,
        data: {
          forwardedTo: toChatId,
          messageId: message.id,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to forward message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * Send new message to another chat
 */
export const actionSendToCapability: Capability = {
  id: 'action_send_to',
  name: '发送消息到窗口',
  type: 'action',
  description: '发送新消息到指定聊天窗口',

  configSchema: {
    toChatId: {
      type: 'string',
      label: '目标聊天ID',
      required: true,
      placeholder: '输入目标聊天的ID',
    },
    template: {
      type: 'textarea',
      label: '消息模板',
      required: true,
      placeholder: '支持 {{变量}} 语法',
    },
  },

  async execute({ message, config, pipelineData, global }) {
    const { toChatId, template } = config;

    if (!toChatId) {
      return {
        success: false,
        error: 'Target chat ID is required',
      };
    }

    if (!template) {
      return {
        success: false,
        error: 'Message template is required',
      };
    }

    try {
      const { callApi } = await import('../../../api/gramjs');
      const { selectChat } = await import('../../selectors');

      const toChat = selectChat(global, toChatId);

      if (!toChat) {
        return {
          success: false,
          error: 'Target chat not found',
        };
      }

      const text = renderTemplate(template, pipelineData);

      await callApi('sendMessage', {
        chat: toChat,
        text,
      });

      return {
        success: true,
        data: {
          sentTo: toChatId,
          sentText: text,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to send message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
