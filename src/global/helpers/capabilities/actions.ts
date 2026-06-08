/**
 * Action capabilities
 * Capabilities that perform actions (mark read, auto reply, etc.)
 */

import type {
  ApiChat,
  ApiInputReplyInfo,
  ApiMessage,
  MediaContent,
} from '../../../api/types';
import type { SendMessageParams } from '../../../types';
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

type SendTrackedMessageParams = Pick<SendMessageParams, 'chat' | 'text' | 'replyInfo' | 'suggestedMedia'> & {
  chat: ApiChat;
  text: string;
  replyInfo?: ApiInputReplyInfo;
  suggestedMedia?: MediaContent;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object');
}

function asMessageId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractSentMessageId(result: unknown): number | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const resultRecord = result as Record<string, unknown>;
  const directId = asMessageId(resultRecord.id)
    ?? asMessageId(resultRecord.messageId)
    ?? asMessageId(resultRecord.localId);

  if (directId !== undefined) {
    return directId;
  }

  if (isRecord(resultRecord.message)) {
    const messageId = asMessageId(resultRecord.message.id)
      ?? asMessageId(resultRecord.message.messageId);

    if (messageId !== undefined) {
      return messageId;
    }
  }

  if (Array.isArray(resultRecord.updates)) {
    for (const update of resultRecord.updates) {
      if (!isRecord(update)) {
        continue;
      }

      const updateId = asMessageId(update.id)
        ?? asMessageId(update.messageId);

      if (updateId !== undefined) {
        return updateId;
      }

      if (isRecord(update.message)) {
        const updateMessageId = asMessageId(update.message.id)
          ?? asMessageId(update.message.messageId);

        if (updateMessageId !== undefined) {
          return updateMessageId;
        }
      }
    }
  }

  return undefined;
}

function parseMessageIds(value: unknown, fallbackMessageId: number): number[] {
  if (Array.isArray(value)) {
    const ids = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));

    return ids.length ? ids : [fallbackMessageId];
  }

  if (typeof value === 'string') {
    const ids = value
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));

    return ids.length ? ids : [fallbackMessageId];
  }

  return [fallbackMessageId];
}

function getRenderedConfigString(
  value: unknown,
  pipelineData: Record<string, any>,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const rendered = renderTemplate(value, pipelineData).trim();
  return rendered || undefined;
}

async function sendMessageWithTracking(
  params: SendTrackedMessageParams,
): Promise<{ sentMessageId?: number; localSentMessageId?: number }> {
  const { callApi } = await import('../../../api/gramjs');
  const localMessage = await callApi('sendMessageLocal', params);

  if (localMessage) {
    const localSentMessageId = localMessage.id;
    const result = await callApi('sendMessage', {
      ...params,
      localMessage,
    });

    return {
      sentMessageId: extractSentMessageId(result) ?? localSentMessageId,
      localSentMessageId,
    };
  }

  const result = await callApi('sendMessage', params);

  return {
    sentMessageId: extractSentMessageId(result),
  };
}

function getCaseMessages(pipelineData: Record<string, any>): ApiMessage[] {
  if (!Array.isArray(pipelineData.caseMessages)) {
    return [];
  }

  return pipelineData.caseMessages.filter((item): item is ApiMessage => {
    return Boolean(item && typeof item === 'object' && 'content' in item && 'id' in item);
  });
}

function getMessageSuggestedMedia(message: ApiMessage | undefined): MediaContent | undefined {
  if (!message) {
    return undefined;
  }

  if (message.content.photo) {
    return { photo: message.content.photo };
  }

  if (message.content.video) {
    return { video: message.content.video };
  }

  if (message.content.document) {
    return { document: message.content.document };
  }

  return undefined;
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
      const { selectThreadReadState } = await import('../../selectors/threads');

      const chat = selectChat(global, message.chatId);
      if (!chat) {
        return {
          success: false,
          error: 'Chat not found',
        };
      }

      const threadId = (message as { threadId?: number }).threadId ?? MAIN_THREAD_ID;

      // Check unread count before marking as read
      const readState = selectThreadReadState(global, message.chatId, MAIN_THREAD_ID);
      const lastReadInboxMessageId = readState?.lastReadInboxMessageId || 0;
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
          error: `Prevented batch read: ${unreadCount} messages would be marked as read, `
            + `exceeds maxUnreadCount (${maxUnreadCount}).`,
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
        // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
          console.error('[RuleEngine] Typing indicator failed:', typingError);
        }

        await waitFor(delayMs);
      }

      const replyInfo = (() => {
        if (replyToOriginal) {
          return {
            type: 'message' as const,
            replyToMsgId: message.id,
            ...(threadId !== MAIN_THREAD_ID && { replyToTopId: threadId }),
          };
        }

        if (threadId !== MAIN_THREAD_ID) {
          return {
            type: 'message' as const,
            replyToMsgId: threadId,
            replyToTopId: threadId,
            isForumTopic: true,
          };
        }

        return undefined;
      })();

      const sentMessage = await sendMessageWithTracking({
        chat,
        text: replyText,
        replyInfo,
      });

      if (typingActionActive) {
        callApi('sendMessageAction', {
          peer: chat,
          threadId,
          action: { type: 'cancel' },
        }).catch((cancelError) => {
          // eslint-disable-next-line no-console
          console.error('[RuleEngine] Typing cancel failed:', cancelError);
        });
      }

      return {
        success: true,
        data: {
          repliedText: replyText,
          sentMessageId: sentMessage.sentMessageId,
          localSentMessageId: sentMessage.localSentMessageId,
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

  configSchema: {
    syncToOncall: {
      type: 'boolean',
      label: '同步加入消息保障',
      default: false,
    },
  },

  async execute({ message, actions, config, global }) {
    try {
      await actions.addToCustomerServiceV2({
        message,
        chatId: message.chatId,
      });

      if (config.syncToOncall) {
        const [
          { selectCustomerServiceV2Settings },
          { selectChat },
          { getMessageText },
          { loadCustomerServiceV2SettingsFromStorage },
          { reportCustomerServiceUsefulMessage },
        ] = await Promise.all([
          import('../../selectors/customerServiceV2'),
          import('../../selectors'),
          import('../messages'),
          import('../customerServiceV2Settings'),
          import('../customerServiceOncall'),
        ]);

        const settings = selectCustomerServiceV2Settings(global)
          || loadCustomerServiceV2SettingsFromStorage();
        const oncallSettings = settings?.oncall;

        if (oncallSettings?.enabled) {
          const chat = selectChat(global, message.chatId);
          const messageText = getMessageText(message);

          reportCustomerServiceUsefulMessage({
            chatId: message.chatId,
            messageId: message.id,
            createdAt: typeof message.date === 'number' ? message.date * 1000 : Date.now(),
            chatTitle: chat?.title,
            senderId: message.senderId,
            text: messageText?.text,
            previewText: messageText?.text,
            oncallConfig: oncallSettings,
          });
        }
      }

      return {
        success: true,
        handled: true,
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
 * Mark a workbench case as resolved and save it as a success case
 */
export const actionResolveCaseCapability: Capability = {
  id: 'action_resolve_case',
  name: '标记 Case 已解决',
  type: 'action',
  description: '将当前工作台 case 标记为已解决并保存为成功样本',

  configSchema: {
    reason: {
      type: 'string',
      label: '解决原因',
      placeholder: '例如：订单已成功，无需继续处理',
    },
    finalReplyTemplate: {
      type: 'textarea',
      label: '最终回复模板',
      placeholder: '可选，支持 {{变量}}；留空表示无需回复',
    },
    summaryTemplate: {
      type: 'textarea',
      label: 'Case 摘要模板',
      placeholder: '可选，默认使用 caseSummary',
    },
    intentTemplate: {
      type: 'string',
      label: '意图模板',
      placeholder: '可选，默认使用 problemType',
    },
  },

  async execute({ message, config, pipelineData, step }) {
    try {
      const [
        { getMessageText },
        { saveCustomerServiceSuccessCase },
      ] = await Promise.all([
        import('../messages'),
        import('../customerServiceOncall'),
      ]);

      const caseId = typeof pipelineData.caseId === 'string' && pipelineData.caseId.trim()
        ? pipelineData.caseId.trim()
        : `message:${message.chatId}:${message.id}`;
      const sourceText = typeof pipelineData.caseText === 'string' && pipelineData.caseText.trim()
        ? pipelineData.caseText.trim()
        : getMessageText(message)?.text || '';
      const finalReply = getRenderedConfigString(config.finalReplyTemplate, pipelineData)
        || (typeof pipelineData.finalReply === 'string' ? pipelineData.finalReply.trim() : '');
      const aiDraft = typeof pipelineData.aiDraft === 'string'
        ? pipelineData.aiDraft.trim()
        : finalReply;
      const reason = getRenderedConfigString(config.reason, pipelineData);
      const aiSummary = getRenderedConfigString(config.summaryTemplate, pipelineData)
        || (typeof pipelineData.caseSummary === 'string' ? pipelineData.caseSummary : undefined);
      const aiIntent = getRenderedConfigString(config.intentTemplate, pipelineData)
        || (typeof pipelineData.problemType === 'string' ? pipelineData.problemType : undefined)
        || (typeof pipelineData.ruleName === 'string' ? pipelineData.ruleName : undefined);
      const messageIds = parseMessageIds(pipelineData.messageIds, message.id);

      const result = await saveCustomerServiceSuccessCase({
        recordType: 'case_resolved',
        caseId,
        chatId: message.chatId,
        senderId: message.senderId,
        messageIds,
        sourceText,
        aiSummary,
        aiIntent,
        aiDraft,
        finalReply,
        wasEdited: Boolean(finalReply && aiDraft && finalReply !== aiDraft),
        metadata: {
          resolvedBy: 'rule_engine',
          reason,
          ruleId: pipelineData.ruleId,
          ruleName: pipelineData.ruleName,
          stepId: step?.id,
          fields: pipelineData.fields,
          missingFields: pipelineData.missingFields,
          confidence: pipelineData.confidence,
          resolvedAt: Date.now(),
        },
      });

      if (!result.ok) {
        return {
          success: false,
          error: result.error || 'Failed to save resolved case',
        };
      }

      return {
        success: true,
        handled: true,
        data: {
          caseResolved: true,
          resolvedCaseId: caseId,
          resolvedReason: reason,
          resolvedRecord: result.record,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to resolve case: ${error instanceof Error ? error.message : String(error)}`,
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
    mode: {
      type: 'select',
      label: '转发模式',
      options: ['原生转发', '复制转发'],
      default: '原生转发',
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
    template: {
      type: 'textarea',
      label: '复制转发模板',
      placeholder: '复制转发时生效，例如：[{chatTitle}] {text}',
    },
  },

  async execute({ message, config, global, pipelineData }) {
    const {
      toChatId,
      mode = '原生转发',
      dropAuthor = false,
      dropCaption = false,
      template,
    } = config;

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
        // eslint-disable-next-line no-console
        console.error('[RuleEngine] Forward mark read failed:', markReadError);
        // Continue even if mark read fails
      }

      if (mode === '复制转发' || mode === '复制文字转发') {
        const renderedText = renderTemplate(template || '{text}', pipelineData);

        if (!renderedText.trim()) {
          return {
            success: false,
            error: 'Copy forward template rendered empty text',
          };
        }

        const sentMessage = await sendMessageWithTracking({
          chat: toChat,
          text: renderedText,
        });

        return {
          success: true,
          data: {
            forwardedTo: toChatId,
            messageId: message.id,
            forwardMode: 'copy_text',
            sentText: renderedText,
            sentMessageId: sentMessage.sentMessageId,
            localSentMessageId: sentMessage.localSentMessageId,
          },
        };
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
          forwardMode: 'native',
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
  description: '发送新消息到指定聊天窗口,也可按模式写入草稿或带 case 媒体发送',

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
    deliveryMode: {
      type: 'select',
      label: '投递模式',
      options: ['send', 'draft', 'draft_in_assist'],
      default: 'send',
    },
    mediaSource: {
      type: 'select',
      label: '媒体来源',
      options: ['none', 'current_message', 'case_first_media', 'case_last_media'],
      default: 'none',
    },
    requireMedia: {
      type: 'boolean',
      label: '发送时要求带媒体',
      default: false,
    },
    openChatOnDraft: {
      type: 'boolean',
      label: '写入草稿后打开目标窗口',
      default: true,
    },
  },

  async execute({
    message, config, pipelineData, global, actions,
  }) {
    const {
      toChatId,
      template,
      deliveryMode = 'send',
      mediaSource = 'none',
      requireMedia = false,
      openChatOnDraft = true,
    } = config;
    const resolvedToChatId = typeof toChatId === 'string'
      ? renderTemplate(toChatId, pipelineData).trim()
      : toChatId;

    if (!resolvedToChatId) {
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
      const { selectChat } = await import('../../selectors');

      const toChat = selectChat(global, resolvedToChatId);

      if (!toChat) {
        return {
          success: false,
          error: 'Target chat not found',
        };
      }

      const text = renderTemplate(template, pipelineData);
      const mode = global.customerServiceV2?.settings?.mode || 'oncall';
      const shouldDraft = deliveryMode === 'draft' || (deliveryMode === 'draft_in_assist' && mode === 'assist');

      if (shouldDraft) {
        actions.saveDraft({
          chatId: resolvedToChatId,
          threadId: MAIN_THREAD_ID,
          text,
        });

        if (openChatOnDraft) {
          actions.openChat({
            id: resolvedToChatId,
          });
        }

        return {
          success: true,
          data: {
            sentTo: resolvedToChatId,
            sentText: text,
            draftSaved: true,
            deliveryMode: 'draft',
          },
        };
      }

      const mediaMessage = (() => {
        if (mediaSource === 'current_message') {
          return message;
        }

        const caseMessages = getCaseMessages(pipelineData);
        if (mediaSource === 'case_first_media') {
          return caseMessages.find((candidate) => Boolean(getMessageSuggestedMedia(candidate)));
        }

        if (mediaSource === 'case_last_media') {
          return [...caseMessages].reverse().find((candidate) => Boolean(getMessageSuggestedMedia(candidate)));
        }

        return undefined;
      })();
      const suggestedMedia = getMessageSuggestedMedia(mediaMessage);

      if (requireMedia && !suggestedMedia) {
        return {
          success: false,
          error: 'Configured mediaSource did not resolve to media',
        };
      }

      const sentMessage = await sendMessageWithTracking({
        chat: toChat,
        text,
        suggestedMedia,
      });

      return {
        success: true,
        data: {
          sentTo: resolvedToChatId,
          sentText: text,
          deliveryMode: 'send',
          mediaMessageId: mediaMessage?.id,
          hasMedia: Boolean(suggestedMedia),
          sentMessageId: sentMessage.sentMessageId,
          localSentMessageId: sentMessage.localSentMessageId,
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
