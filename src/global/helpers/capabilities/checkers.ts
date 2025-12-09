/**
 * Checker capabilities
 * Capabilities that check message properties and conditions
 */

import type { ApiMessage } from '../../../api/types';
import type { Capability } from '../../types/customerServiceV2';
import { getMessageText } from '../messages';

/**
 * Check if message text matches a pattern
 */
export const checkTextMatchCapability: Capability = {
  id: 'check_text_match',
  name: '文本匹配检测',
  type: 'checker',
  description: '检查消息文本是否匹配指定条件',

  configSchema: {
    pattern: {
      type: 'string',
      label: '匹配模式',
      placeholder: '输入关键词或正则表达式',
      required: true,
    },
    mode: {
      type: 'select',
      label: '匹配方式',
      options: ['包含', '正则', '完全相等'],
      default: '包含',
    },
  },

  async execute({ message, config, pipelineData }) {
    const text = pipelineData.text || getMessageText(message)?.text || '';

    // Store text in pipeline data for other capabilities
    pipelineData.text = text;

    let matched = false;
    const { pattern, mode = '包含' } = config;

    if (!pattern) {
      return {
        success: false,
        error: 'Pattern is required',
      };
    }

    try {
      if (mode === '包含') {
        matched = text.includes(pattern);
      } else if (mode === '正则') {
        matched = new RegExp(pattern).test(text);
      } else if (mode === '完全相等') {
        matched = text === pattern;
      }
    } catch (error) {
      return {
        success: false,
        error: `Pattern matching failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      success: matched,
      data: {
        matched,
        matchedText: matched ? text : undefined,
      },
    };
  },
};

/**
 * Check if message has been replied
 */
export const checkHasReplyCapability: Capability = {
  id: 'check_has_reply',
  name: '回复检测',
  type: 'checker',
  description: '检查消息是否已被回复',

  configSchema: {
    timeWindow: {
      type: 'number',
      label: '时间窗口(秒)',
      default: 300,
      placeholder: '检查多少秒内的回复',
    },
  },

  async execute({ message, config, global }) {
    const { timeWindow = 300 } = config;
    const { selectChatMessages } = await import('../../selectors');

    const chatMessages = selectChatMessages(global, message.chatId);
    if (!chatMessages) {
      return {
        success: false,
        data: {
          hasReply: false,
          replyCount: 0,
        },
      };
    }

    const windowEnd = message.date + timeWindow;
    const messageList = Object.values(chatMessages);

    const replies = messageList.filter(
      (m: ApiMessage) => (m as any).replyToMessageId === message.id
        && m.date > message.date
        && m.date <= windowEnd,
    );

    const hasReply = replies.length > 0;

    return {
      success: hasReply,
      data: {
        hasReply,
        replyCount: replies.length,
        lastReplyTime: replies.length > 0
          ? Math.max(...replies.map((r: ApiMessage) => r.date))
          : undefined,
      },
    };
  },
};
