/**
 * Checker capabilities
 * Capabilities that check message properties and conditions
 */

import type { ApiMessage } from '../../../api/types';
import type { Capability } from '../../types/customerServiceV2';

import { getMessageText } from '../messages';

type SwitchRouteCase = {
  match: string;
  gotoStep?: string;
  mode?: 'contains' | 'equals' | 'regex';
  flags?: string;
  data?: Record<string, unknown>;
};

function parseSwitchCases(rawCases: unknown): SwitchRouteCase[] {
  if (Array.isArray(rawCases)) {
    return rawCases.filter((item): item is SwitchRouteCase => {
      return Boolean(
        item
        && typeof item === 'object'
        && 'match' in item
        && typeof item.match === 'string'
        && (
          !('gotoStep' in item)
          || typeof item.gotoStep === 'string'
        )
        && (
          !('data' in item)
          || (
            item.data
            && typeof item.data === 'object'
            && !Array.isArray(item.data)
          )
        ),
      );
    });
  }

  if (typeof rawCases !== 'string' || !rawCases.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawCases) as unknown;
    return parseSwitchCases(parsed);
  } catch {
    return [];
  }
}

function switchCaseMatches(
  value: string,
  routeCase: SwitchRouteCase,
  defaultMode: SwitchRouteCase['mode'],
): boolean {
  const mode = routeCase.mode || defaultMode || 'contains';

  if (mode === 'equals') {
    return value === routeCase.match;
  }

  if (mode === 'regex') {
    try {
      return new RegExp(routeCase.match, routeCase.flags || '').test(value);
    } catch {
      return false;
    }
  }

  return value.includes(routeCase.match);
}

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

    // Variable Comparison (New)
    variableKey: {
      type: 'string',
      label: '检查变量名',
      placeholder: '如 botReplyText 或 chat.title',
    },
    variableOperator: {
      type: 'select',
      label: '变量操作符',
      options: ['contains', 'equals', 'regex', 'exists', 'not_exists'],
      default: 'contains',
    },
    variableExpectedValue: {
      type: 'string',
      label: '期望值',
      placeholder: '支持 {{变量}} 语法',
    },
  },

  async execute({
    message, config, pipelineData, global,
  }) {
    const {
      textPattern,
      textMode = '包含',
      checkHasPhoto = false,
      checkHasVideo = false,
      checkIsReply = false,
      variableKey,
      variableOperator = 'contains',
      variableExpectedValue,
    } = config;

    const results: Record<string, any> = {};
    let allChecksPassed = true;

    // 1. Basic Message Checks (Text, Media, Reply)
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
      if (!textMatched) allChecksPassed = false;
    }

    if (checkHasPhoto && message.content.photo === undefined) allChecksPassed = false;
    if (checkHasVideo && message.content.video === undefined) allChecksPassed = false;
    if (checkIsReply && message.replyInfo === undefined) allChecksPassed = false;

    // 2. Variable Comparison Logic (Advanced)
    if (variableKey) {
      let actualValue: any;

      // Handle special metadata and normal variables
      if (variableKey === 'chat.title' || variableKey === 'chatTitle') {
        actualValue = pipelineData.chatTitle;
      } else {
        actualValue = pipelineData[variableKey];
      }

      // Render expected value if it contains templates
      const { renderTemplate } = await import('../templateRenderer');
      const expectedValue = variableExpectedValue ? renderTemplate(variableExpectedValue, pipelineData) : '';

      let varPassed: boolean;
      const actualString = String(actualValue || '');

      // Security Check: If expectedValue is empty but operator is contains/equals/regex,
      // it's likely a missing variable. Don't allow it to pass to prevent false positives.
      if (
        !expectedValue
        && (variableOperator === 'contains' || variableOperator === 'equals' || variableOperator === 'regex')
      ) {
        varPassed = false;
      } else {
        switch (variableOperator) {
          case 'exists':
            varPassed = actualValue !== undefined
              && (typeof actualValue !== 'object' || Boolean(actualValue))
              && actualValue !== '';
            break;
          case 'not_exists':
            varPassed = actualValue === undefined
              || (typeof actualValue === 'object' && !actualValue)
              || actualValue === '';
            break;
          case 'equals':
            varPassed = actualString === expectedValue;
            break;
          case 'contains':
            varPassed = actualString.includes(expectedValue);
            break;
          case 'regex':
            try {
              varPassed = new RegExp(expectedValue).test(actualString);
            } catch (e) {
              varPassed = false;
            }
            break;
          default:
            varPassed = false;
        }
      }

      results.variableCheck = {
        key: variableKey,
        actualValue,
        expectedValue,
        passed: varPassed,
      };
      if (!varPassed) allChecksPassed = false;
    }

    return {
      success: allChecksPassed,
      data: results,
    };
  },
};

/**
 * Wait for a reply in a specific chat
 */
export const waitForReplyCapability: Capability = {
  id: 'wait_for_reply',
  name: '等待回复',
  type: 'checker',
  description: '在指定聊天中等待特定消息的回复(非阻塞)',

  configSchema: {
    chatId: {
      type: 'string',
      label: '目标聊天ID',
      placeholder: '留空表示当前聊天',
    },
    messageIdField: {
      type: 'string',
      label: '消息ID字段',
      default: 'sentMessageId',
      placeholder: 'pipelineData 中的字段名',
    },
    timeout: {
      type: 'number',
      label: '超时秒数',
      default: 60,
    },
    pollInterval: {
      type: 'number',
      label: '轮询间隔(秒)',
      default: 5,
    },
  },

  async execute({ message, config, pipelineData }) {
    await Promise.resolve();

    const {
      chatId = message.chatId,
      messageIdField = 'sentMessageId',
      timeout = 60,
      pollInterval = 5,
    } = config;

    const targetMessageId = pipelineData[messageIdField];
    if (!targetMessageId) {
      return {
        success: false,
        error: `Target message ID not found in pipelineData.${messageIdField}`,
      };
    }

    const startTime = Date.now();

    // eslint-disable-next-line no-console
    console.log(`[wait_for_reply] Waiting for reply to ${targetMessageId} in ${chatId}`);

    return {
      success: true,
      deferred: {
        delay: pollInterval * 1000,
        checkFn: async () => {
          const { getGlobal } = await import('../../index');
          const { selectChatMessages } = await import('../../selectors');
          const { getMessageText: getReplyMessageText } = await import('../messages');
          const { sleep } = await import('../../../util/delays');

          while (Date.now() - startTime < timeout * 1000) {
            const freshGlobal = getGlobal();
            const chatMessages = selectChatMessages(freshGlobal, chatId);

            if (chatMessages) {
              const replies = Object.values(chatMessages).filter((m: ApiMessage) => {
                return m.replyInfo?.type === 'message' && m.replyInfo.replyToMsgId === targetMessageId;
              });

              if (replies.length > 0) {
                const lastReply = replies[replies.length - 1];
                const replyText = getReplyMessageText(lastReply)?.text || '';
                // eslint-disable-next-line no-console
                console.log(`[wait_for_reply] Found reply: ${replyText}`);

                // Mark the reply as read (human-like behavior)
                try {
                  const { callApi } = await import('../../../api/gramjs');
                  const { selectChat } = await import('../../selectors');
                  const chat = selectChat(freshGlobal, chatId);
                  if (chat) {
                    const threadId = (lastReply as { threadId?: number }).threadId || 0;
                    await callApi('markMessageListRead', {
                      chat,
                      threadId,
                      maxId: lastReply.id,
                    });
                  }
                } catch (error) {
                  // eslint-disable-next-line no-console
                  console.error('[wait_for_reply] Mark read failed:', error);
                }

                return {
                  success: true,
                  data: {
                    botReplyText: replyText,
                    botReplyMessageId: lastReply.id,
                  },
                };
              }
            }

            // Wait for next poll
            await sleep(pollInterval * 1000);
          }

          // eslint-disable-next-line no-console
          console.log('[wait_for_reply] Timeout reached');
          return false;
        },
      },
    };
  },
};

/**
 * Route the pipeline to one of many steps based on a variable value.
 */
export const switchRouteCapability: Capability = {
  id: 'switch_route',
  name: '多分支路由',
  type: 'checker',
  description: '根据 pipelineData 字段匹配多个 case, 输出可用于 gotoStep 的目标步骤',

  configSchema: {
    inputField: {
      type: 'string',
      label: '输入字段',
      default: 'text',
      placeholder: '例如 botReplyText',
    },
    casesJson: {
      type: 'textarea',
      label: '分支 JSON',
      required: true,
      placeholder: '[{"match":"供应商A","gotoStep":"supplier_a","data":{"targetChatId":"-100..."}}]',
    },
    defaultGotoStep: {
      type: 'string',
      label: '默认步骤',
      placeholder: '没有命中时跳转的步骤 ID',
    },
    outputField: {
      type: 'string',
      label: '输出字段',
      default: 'switchGotoStep',
    },
    dataOutputField: {
      type: 'string',
      label: '数据输出字段',
      default: 'switchData',
    },
    defaultMode: {
      type: 'select',
      label: '默认匹配模式',
      options: ['contains', 'equals', 'regex'],
      default: 'contains',
    },
  },

  execute({ config, pipelineData }) {
    const {
      inputField = 'text',
      casesJson,
      defaultGotoStep,
      outputField = 'switchGotoStep',
      dataOutputField = 'switchData',
      defaultMode = 'contains',
    } = config;

    const value = String(pipelineData[inputField] || '');
    const cases = parseSwitchCases(casesJson);

    if (cases.length === 0) {
      return Promise.resolve({
        success: false,
        error: 'No valid switch cases configured',
      });
    }

    const matchedCase = cases.find((routeCase) => switchCaseMatches(
      value,
      routeCase,
      defaultMode,
    ));

    const gotoStep = matchedCase?.gotoStep || defaultGotoStep;
    const switchData = matchedCase?.data || {};

    if (!gotoStep && Object.keys(switchData).length === 0) {
      return Promise.resolve({
        success: false,
        data: {
          switchMatched: false,
        },
      });
    }

    return Promise.resolve({
      success: true,
      data: {
        [outputField]: gotoStep,
        [dataOutputField]: switchData,
        switchGotoStep: gotoStep,
        switchData,
        switchMatched: Boolean(matchedCase),
        switchMatchedValue: matchedCase?.match || '',
      },
    });
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

  execute({ message, config }) {
    const { timeWindow = 300 } = config;

    // eslint-disable-next-line no-console
    console.log(`[check_has_reply] Scheduling reply check for message ${message.id} in ${timeWindow} seconds`);

    // Return deferred task - async executor will handle it
    return Promise.resolve({
      success: true, // Initial success, actual result determined by checkFn
      handled: true,
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
          console.log(
            `[check_has_reply] After ${timeWindow}s delay: message ${message.id} has ${replies.length} replies`,
          );

          return hasReply;
        },
      },
    });
  },
};
