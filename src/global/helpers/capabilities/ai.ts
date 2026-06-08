/**
 * AI capabilities
 * Uses external AI profiles from customer service settings.
 */

import type { Capability, CustomerServiceAiChatMessage } from '../../types/customerServiceV2';

import {
  getCustomerServiceAiSystemPrompt,
  isCustomerServiceAiProfileReady,
  requestCustomerServiceAiChat,
  selectCustomerServiceAiProfile,
} from '../customerServiceAi';
import {
  loadCustomerServiceV2SettingsFromStorage,
} from '../customerServiceV2Settings';
import { renderTemplate } from '../templateRenderer';

const DEFAULT_AI_REPLY_OUTPUT_FIELD = 'aiReply';
const DEFAULT_AI_REPLY_PROMPT = [
  '请根据下面的客服 case 生成一条可以直接发给客户的回复。',
  '',
  '会话: {{chatTitle}}',
  '发送者: {{senderName}}',
  '消息: {{text}}',
  'OCR: {{ocrText}}',
  '已提取订单号: {{orderNumber}}',
  '',
  '要求:',
  '1. 只输出回复正文，不要解释。',
  '2. 不确定时不要编造结果。',
  '3. 需要查询时告诉客户“我先帮您核对，请稍等”。',
].join('\n');

function toTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function buildMessages(params: {
  systemPrompt: string;
  additionalSystemPrompt?: string;
  userPrompt: string;
}): CustomerServiceAiChatMessage[] {
  const systemContent = [
    params.systemPrompt,
    params.additionalSystemPrompt,
  ].filter(Boolean).join('\n\n');

  return [
    {
      role: 'system',
      content: systemContent,
    },
    {
      role: 'user',
      content: params.userPrompt,
    },
  ];
}

export const aiGenerateReplyCapability: Capability = {
  id: 'ai_generate_reply',
  name: 'AI 生成回复',
  type: 'extractor',
  description: '根据当前 case 上下文调用外部 AI Profile 生成客服回复草稿',

  configSchema: {
    profileId: {
      type: 'string',
      label: 'AI Profile ID',
      default: '',
      placeholder: '留空使用默认启用 profile',
    },
    businessKey: {
      type: 'string',
      label: '业务 Key',
      default: '',
      placeholder: '如 recharge/order/risk',
    },
    outputField: {
      type: 'string',
      label: '回复输出字段',
      default: DEFAULT_AI_REPLY_OUTPUT_FIELD,
      placeholder: 'pipelineData 字段名',
    },
    prompt: {
      type: 'textarea',
      label: '用户提示词模板',
      default: DEFAULT_AI_REPLY_PROMPT,
      placeholder: '可使用 {{text}}、{{chatTitle}}、{{orderNumber}} 等变量',
    },
    systemPrompt: {
      type: 'textarea',
      label: '附加系统提示词',
      default: '',
      placeholder: '可选，叠加到 profile 的系统提示词后',
    },
  },

  async execute({ config, global, pipelineData }) {
    const settings = global.customerServiceV2?.settings
      || loadCustomerServiceV2SettingsFromStorage();
    const profileId = toTrimmedString(config.profileId);
    const businessKey = toTrimmedString(config.businessKey);
    const profile = selectCustomerServiceAiProfile(settings, {
      profileId,
      businessKey,
      includeDisabled: Boolean(profileId || businessKey),
    });

    if (!profile) {
      return {
        success: false,
        error: 'No AI profile configured.',
      };
    }

    if (!isCustomerServiceAiProfileReady(profile)) {
      return {
        success: false,
        error: `AI profile "${profile.name || profile.id}" is disabled or missing API configuration.`,
      };
    }

    const outputField = toTrimmedString(config.outputField) || DEFAULT_AI_REPLY_OUTPUT_FIELD;
    const userPromptTemplate = toTrimmedString(config.prompt) || DEFAULT_AI_REPLY_PROMPT;
    const userPrompt = renderTemplate(userPromptTemplate, pipelineData);
    const messages = buildMessages({
      systemPrompt: getCustomerServiceAiSystemPrompt(profile),
      additionalSystemPrompt: toTrimmedString(config.systemPrompt),
      userPrompt,
    });

    const result = await requestCustomerServiceAiChat(profile, messages);
    if (!result.ok || !result.content) {
      return {
        success: false,
        error: result.error || 'AI reply generation failed.',
      };
    }

    return {
      success: true,
      data: {
        [outputField]: result.content,
        aiReply: result.content,
        aiProfileId: profile.id,
        aiProfileName: profile.name,
        aiProvider: profile.provider,
        aiModel: result.model || profile.model,
      },
    };
  },
};
