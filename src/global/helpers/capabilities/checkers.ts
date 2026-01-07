/**
 * Checker capabilities
 * Capabilities that check message properties and conditions
 */

import type { ApiMessage } from '../../../api/types';
import type { Capability } from '../../types/customerServiceV2';
import { getMessageText } from '../messages';
import { waitHumanLike } from '../../../util/delays';

/**
 * Check message content and properties
 */
export const checkMessageCapability: Capability = {
  id: 'check_message',
  name: '消息检测',
  type: 'checker',
  description: '检查消息内容和属性(文本/图片/视频/引用)',

  configSchema: {
    textPattern: {
      type: 'string',
      label: '文本匹配模式',
      placeholder: '输入关键词或正则表达式',
    },
    textMode: {
      type: 'select',
      label: '文本匹配方式',
      options: ['包含', '正则', '完全相等'],
      default: '包含',
    },
    checkHasPhoto: {
      type: 'boolean',
      label: '检查是否有图片',
      default: false,
    },
    checkHasVideo: {
      type: 'boolean',
      label: '检查是否有视频',
      default: false,
    },
    checkIsReply: {
      type: 'boolean',
      label: '检查是否有引用',
      default: false,
    },
  },

  async execute({ message, config, pipelineData }) {
    await waitHumanLike({ minMs: 120, maxMs: 280 });

    const {
      textPattern,
      textMode = '包含',
      checkHasPhoto = false,
      checkHasVideo = false,
      checkIsReply = false,
    } = config;

    const results: Record<string, any> = {};
    let allChecksPassed = true;

    // Check text if textPattern is provided
    if (textPattern) {
      const text = pipelineData.text || getMessageText(message)?.text || '';
      pipelineData.text = text;

      let textMatched = false;
      try {
        if (textMode === '包含') {
          textMatched = text.includes(textPattern);
        } else if (textMode === '正则') {
          textMatched = new RegExp(textPattern).test(text);
        } else if (textMode === '完全相等') {
          textMatched = text === textPattern;
        }
      } catch (error) {
        return {
          success: false,
          error: `Text pattern matching failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      results.textMatched = textMatched;
      results.matchedText = textMatched ? text : undefined;
      if (!textMatched) allChecksPassed = false;
    }

    // Check photo
    if (checkHasPhoto) {
      const hasPhoto = message.content.photo !== undefined;
      results.hasPhoto = hasPhoto;
      if (!hasPhoto) allChecksPassed = false;
    }

    // Check video
    if (checkHasVideo) {
      const hasVideo = message.content.video !== undefined;
      results.hasVideo = hasVideo;
      if (!hasVideo) allChecksPassed = false;
    }

    // Check reply/quote
    if (checkIsReply) {
      const isReply = message.replyInfo !== undefined;
      results.isReply = isReply;
      if (isReply && message.replyInfo) {
        results.replyInfo = {
          type: message.replyInfo.type,
          ...(message.replyInfo.type === 'message' && {
            replyToMsgId: message.replyInfo.replyToMsgId,
            replyToPeerId: message.replyInfo.replyToPeerId,
          }),
        };
      }
      if (!isReply) allChecksPassed = false;
    }

    return {
      success: allChecksPassed,
      data: results,
    };
  },
};

/**
 * Check if message has been replied (with delay)
 * Non-blocking: returns a deferred task that the async executor will handle
 * Uses step's onSuccess/onFailure routing to handle the result
 */
export const checkHasReplyCapability: Capability = {
  id: 'check_has_reply',
  name: '回复检测',
  type: 'checker',
  description: '等待指定时长后检查消息是否已被回复(非阻塞)',

  configSchema: {
    timeWindow: {
      type: 'number',
      label: '等待时长(秒)',
      default: 300,
      placeholder: '等待多少秒后检查回复',
    },
  },

  async execute({ message, config }) {
    await waitHumanLike({ minMs: 120, maxMs: 280 });

    const { timeWindow = 300 } = config;

    // eslint-disable-next-line no-console
    console.log(`[check_has_reply] Scheduling reply check for message ${message.id} in ${timeWindow} seconds`);

    // Return deferred task - async executor will handle it
    return {
      success: true, // Initial success, actual result determined by checkFn
      data: {
        scheduled: true,
        timeWindow,
        messageId: message.id,
      },
      deferred: {
        delay: timeWindow * 1000,
        checkFn: async () => {
          // Import dependencies inside checkFn
          const { getGlobal } = await import('../../index');
          const { selectChatMessages } = await import('../../selectors');

          // Get fresh global state
          const freshGlobal = getGlobal();
          const chatMessages = selectChatMessages(freshGlobal, message.chatId);

          if (!chatMessages) {
            // eslint-disable-next-line no-console
            console.log(`[check_has_reply] Chat messages not found for ${message.chatId}`);
            return false;
          }

          const messageList = Object.values(chatMessages);

          // Check for messages that reply to our target message
          const replies = messageList.filter((m: ApiMessage) => {
            if (!m.replyInfo || m.replyInfo.type !== 'message') return false;
            return m.replyInfo.replyToMsgId === message.id && m.date > message.date;
          });

          const hasReply = replies.length > 0;

          // eslint-disable-next-line no-console
          console.log(`[check_has_reply] After ${timeWindow}s delay: message ${message.id} has ${replies.length} replies`);

          return hasReply;
        },
      },
    };
  },
};
