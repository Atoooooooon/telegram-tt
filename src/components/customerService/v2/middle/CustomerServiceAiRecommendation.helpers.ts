import type { ApiMessage } from '../../../../api/types';
import type {
  CustomerServiceCasePlaybook,
  CustomerServiceMessageGroup,
} from '../../../../global/types/customerServiceV2';

import {
  CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_BUSINESS_KEY,
} from '../../../../global/helpers/customerServiceV2Settings';
import { isDocumentPhoto } from '../../../../global/helpers/messageMedia';

export type AssistantInsight = {
  problemType: string;
  summary: string;
  confidence: number;
  fields: Array<{ label: string; value: string }>;
  missingFields: string[];
  suggestedReply: string;
  needsLookup: boolean;
};

export type AiPlaybookRecommendation = {
  requestKey: string;
  intent: string;
  scenarioId?: string;
  hasRunnablePlaybook: boolean;
  playbookId?: string;
  reason: string;
  confidence?: number;
  mediaPolicy?: string;
  imageSummary?: string;
  knowledgeAvailable?: boolean;
  knowledgeSource?: string;
  knowledgeError?: string;
  error?: string;
  rawContent?: string;
  rawJsonText?: string;
  finishReason?: string;
};

export const AI_PLAYBOOK_RECOMMENDER_BUSINESS_KEY = CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_BUSINESS_KEY;
export const MAX_AI_RECOMMENDATION_IMAGE_COUNT = 2;
export const AI_RECOMMENDATION_SETTLE_DELAY_MS = 8000;
export const AI_RECOMMENDATION_MAX_WAIT_MS = 30000;

const MAX_AI_SCENARIO_KNOWLEDGE_CHARS = 20000;
const ORDER_NUMBER_PATTERNS = [
  /(?:订单号|订单|单号|流水号|order|id)[:：\s#]*([A-Za-z0-9][A-Za-z0-9_-]{7,63})/i,
  /\b(ORD[-_A-Za-z0-9]{6,})\b/i,
  /\b([A-Za-z0-9][A-Za-z0-9-]{12,63})\b/,
];

export const AI_DRAFT_USER_PROMPT = [
  '请根据这个客服 case 生成一条可以直接发送给客户的回复。',
  '',
  '问题类型: {problemType}',
  '当前摘要: {summary}',
  '结构化字段: {fields}',
  '缺失字段: {missingFields}',
  '',
  '最近消息:',
  '{contextText}',
  '',
  '只输出回复正文。不要解释、不要编造核对结果。',
].join('\n');

const AI_PLAYBOOK_RECOMMENDATION_SYSTEM_PROMPT = [
  '你是客服工作台的 case 意图分类与 playbook 推荐器。',
  '你会收到场景知识库 Markdown、当前 case 上下文、媒体摘要和当前可运行 playbooks。',
  '先根据场景知识库识别 intent 和 scenarioId，再判断当前可运行 playbooks 中是否有合适流程。',
  '只有当前可运行 playbooks 中存在明确匹配流程时，hasRunnablePlaybook 才能为 true。',
  '如果场景能识别但没有可运行 playbook，hasRunnablePlaybook 必须为 false，playbookId 必须为 null。',
  '如果附带图片，可以读取图片内容来辅助判断问题意图、凭证类型和是否需要查询。',
  '不要要求上传视频、语音或普通文件；这类内容只能根据文本描述分类，视频核对交给人工。',
  '推荐阶段只判断 case 意图，不要根据用户消息中的图片或单号猜测 VA/QRIS 等支付渠道。',
  '如果支付渠道需要机器人回复或 OCR 才能确定，优先推荐能先查询再分支的通用流程。',
  '不要编造 playbook，不要输出解释文本，不要输出 Markdown，只输出单行严格 JSON。',
  'JSON 字符串内不要换行；必须正确转义双引号和反斜杠。',
  [
    'JSON 格式: ',
    '{"intent":"意图名称",',
    '"scenarioId":"场景英文id",',
    '"hasRunnablePlaybook":true,',
    '"playbookId":"候选playbook id或null",',
    '"reason":"一句中文理由",',
    '"confidence":0-100,',
    '"mediaPolicy":"images_allowed|text_only|do_not_upload_video",',
    '"imageSummary":"如果看到了图片，用一句话说明图片内容；没有图片则为空字符串"}',
  ].join(''),
].join('\n');

export function getFieldValue(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return (match[1] || match[2] || match[0]).trim();
    }
  }

  return undefined;
}

export function extractOrderNumberFromText(text: string) {
  return getFieldValue(text, ORDER_NUMBER_PATTERNS);
}

export function inferProblemType(text: string) {
  if (/查单|单号|订单|凭证|qris|rrn|\/ds|va\b|order/i.test(text)) {
    return '支付订单查询';
  }

  if (/支付|订单|单号|order|ord-|付款|待支付/i.test(text)) {
    return '支付订单查询';
  }

  if (/充值|到账|余额|入账/i.test(text)) {
    return '充值到账查询';
  }

  if (/账号|登录|登陆|锁定|密码|封禁/i.test(text)) {
    return '账号异常';
  }

  if (/风控|审核|验证|kyc|实名/i.test(text)) {
    return '风控确认';
  }

  return '客户咨询';
}

export function buildSuggestedReply(problemType: string, orderId?: string, missingFields: string[] = []) {
  if (missingFields.includes('订单号')) {
    return '您好，请提供一下订单号或支付截图，我这边帮您核对。';
  }

  if (problemType === '支付订单查询' && orderId) {
    return `您好，我先帮您核对订单 ${orderId} 的支付状态，请稍等一下。`;
  }

  if (problemType === '充值到账查询') {
    return '您好，我先帮您核对充值到账情况，请稍等一下。';
  }

  if (problemType === '账号异常') {
    return '您好，我先帮您核对账号状态，请稍等一下。';
  }

  if (problemType === '风控确认') {
    return '您好，这个情况我先帮您提交确认，请稍等。';
  }

  return '您好，我已收到您的消息，我先帮您核对一下。';
}

function getPlaybookScope(playbook: CustomerServiceCasePlaybook) {
  return playbook.scope || 'case';
}

export function buildAiPlaybookRecommendationPrompt(params: {
  playbooks: CustomerServiceCasePlaybook[];
  insight: AssistantInsight;
  caseText: string;
  mediaSummary: string;
}) {
  const playbookLines = params.playbooks.map((playbook) => ({
    id: playbook.id,
    name: playbook.name,
    description: playbook.description || '',
    scope: getPlaybookScope(playbook),
    intent: playbook.caseMatcher?.intent || '',
    keywords: playbook.caseMatcher?.keywords || [],
    requiresFields: playbook.caseMatcher?.requiresFields || [],
  }));
  const fieldsText = params.insight.fields.length
    ? params.insight.fields.map((field) => `${field.label}=${field.value}`).join(', ')
    : '无';

  return [
    '请根据 system 中的场景知识库识别当前 case 意图，并判断是否有可运行 playbook。',
    '如果没有可运行 playbook，仍然输出识别到的 intent/scenarioId，但 hasRunnablePlaybook=false。',
    '',
    `问题类型: ${params.insight.problemType}`,
    `摘要: ${params.insight.summary}`,
    `字段: ${fieldsText}`,
    `缺失字段: ${params.insight.missingFields.join(', ') || '无'}`,
    `媒体摘要: ${params.mediaSummary || '无'}`,
    '',
    '最近消息:',
    params.caseText || params.insight.summary,
    '',
    'playbooks:',
    JSON.stringify(playbookLines, undefined, 2),
  ].join('\n');
}

export function buildAiRecommendationSystemPrompt(params: {
  profilePrompt: string;
  knowledgeContent?: string;
  knowledgeSource?: string;
  knowledgeUnavailable?: boolean;
  knowledgeError?: string;
}) {
  const trimmedKnowledge = params.knowledgeContent?.trim();
  const knowledgeText = trimmedKnowledge
    ? trimmedKnowledge.slice(0, MAX_AI_SCENARIO_KNOWLEDGE_CHARS)
    : '场景知识库当前不可用。只能基于当前 case 文本和可运行 playbooks 做保守判断。';
  const truncatedNote = trimmedKnowledge && trimmedKnowledge.length > MAX_AI_SCENARIO_KNOWLEDGE_CHARS
    ? `\n\n[知识库已截断到前 ${MAX_AI_SCENARIO_KNOWLEDGE_CHARS} 字符]`
    : '';

  return [
    params.profilePrompt,
    '',
    AI_PLAYBOOK_RECOMMENDATION_SYSTEM_PROMPT,
    '',
    '场景知识库状态:',
    `source=${params.knowledgeSource || 'unknown'}`,
    `available=${params.knowledgeUnavailable ? 'false' : 'true'}`,
    params.knowledgeError ? `error=${params.knowledgeError}` : '',
    '',
    '场景知识库 Markdown:',
    knowledgeText + truncatedNote,
  ].filter(Boolean).join('\n');
}

export function parseAiPlaybookRecommendation(
  content: string,
  requestKey: string,
  candidateIds: string[],
  finishReason?: string,
  knowledge?: {
    available: boolean;
    source?: string;
    error?: string;
  },
): AiPlaybookRecommendation {
  const trimmed = content.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/\{[\s\S]*\}/)?.[0] || '';

  if (!jsonText) {
    return {
      requestKey,
      intent: '未识别',
      hasRunnablePlaybook: false,
      reason: 'AI 未返回 JSON 推荐。',
      error: 'AI 未返回 JSON 推荐。',
      rawContent: content,
      finishReason,
      knowledgeAvailable: knowledge?.available,
      knowledgeSource: knowledge?.source,
      knowledgeError: knowledge?.error,
    };
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('AI 推荐 JSON root 必须是对象');
    }

    const record = parsed as Record<string, unknown>;
    const intent = typeof record.intent === 'string' && record.intent.trim()
      ? record.intent.trim()
      : '未识别';
    const scenarioId = typeof record.scenarioId === 'string' && record.scenarioId.trim()
      ? record.scenarioId.trim()
      : undefined;
    const hasRunnablePlaybook = record.hasRunnablePlaybook === true;
    const playbookId = typeof record.playbookId === 'string' ? record.playbookId.trim() : '';

    if (hasRunnablePlaybook && !candidateIds.includes(playbookId)) {
      return {
        requestKey,
        intent,
        scenarioId,
        hasRunnablePlaybook: false,
        reason: `AI 推荐了不可用 playbook: ${playbookId || '<empty>'}`,
        error: `AI 推荐了不可用 playbook: ${playbookId || '<empty>'}`,
        rawContent: content,
        rawJsonText: jsonText,
        finishReason,
        knowledgeAvailable: knowledge?.available,
        knowledgeSource: knowledge?.source,
        knowledgeError: knowledge?.error,
      };
    }

    const confidence = Number(record.confidence);
    const mediaPolicy = typeof record.mediaPolicy === 'string' && record.mediaPolicy.trim()
      ? record.mediaPolicy.trim()
      : undefined;
    const imageSummary = typeof record.imageSummary === 'string' && record.imageSummary.trim()
      ? record.imageSummary.trim()
      : undefined;

    return {
      requestKey,
      intent,
      scenarioId,
      hasRunnablePlaybook,
      playbookId: hasRunnablePlaybook ? playbookId : undefined,
      reason: typeof record.reason === 'string' && record.reason.trim()
        ? record.reason.trim()
        : hasRunnablePlaybook ? 'AI 推荐该 playbook。' : 'AI 识别到意图，但当前没有可执行 playbook。',
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : undefined,
      mediaPolicy,
      imageSummary,
      knowledgeAvailable: knowledge?.available,
      knowledgeSource: knowledge?.source,
      knowledgeError: knowledge?.error,
      rawContent: content,
      rawJsonText: jsonText,
      finishReason,
    };
  } catch (error) {
    const parseError = error instanceof Error ? error.message : 'AI 推荐解析失败。';
    return {
      requestKey,
      intent: '未识别',
      hasRunnablePlaybook: false,
      reason: `AI 返回 JSON 格式不完整: ${parseError}`,
      error: `AI 返回 JSON 格式不完整: ${parseError}`,
      rawContent: content,
      rawJsonText: jsonText,
      finishReason,
      knowledgeAvailable: knowledge?.available,
      knowledgeSource: knowledge?.source,
      knowledgeError: knowledge?.error,
    };
  }
}

function getMessagePlainText(message: ApiMessage) {
  const text = message.content.text?.text || '';
  return message.content.text?.emojiOnlyCount ? '' : text.trim();
}

export function hasAiSupportedImage(message: ApiMessage) {
  const document = message.content.document;
  return Boolean(message.content.photo || (document && isDocumentPhoto(document)));
}

function hasAiUnsupportedMedia(message: ApiMessage) {
  const document = message.content.document;
  const hasNonImageDocument = Boolean(document && !isDocumentPhoto(document));

  return Boolean(
    message.content.video
    || message.content.voice
    || message.content.audio
    || message.content.sticker
    || hasNonImageDocument,
  );
}

export function getAiRecommendationMediaSummary(group: CustomerServiceMessageGroup) {
  const imageCount = group.messages.filter(hasAiSupportedImage).length;
  const unsupportedCount = group.messages.filter(hasAiUnsupportedMedia).length;
  const parts = [];

  if (imageCount) {
    parts.push(`图片/图片文件 ${imageCount} 条，可上传最近 ${MAX_AI_RECOMMENDATION_IMAGE_COUNT} 张给视觉模型`);
  }

  if (unsupportedCount) {
    parts.push(`视频/语音/普通文件/贴纸 ${unsupportedCount} 条，不上传给 AI，只能按文本上下文判断`);
  }

  return parts.join('；');
}

export function getAiRecommendationTriggerInfo(group: CustomerServiceMessageGroup) {
  const texts = group.messages.map(getMessagePlainText).filter(Boolean);
  const caseText = texts.join('\n');
  const hasText = Boolean(caseText.trim());
  const hasOrderNumber = Boolean(extractOrderNumberFromText(caseText));
  const hasKeyword = /(查单|订单|单号|凭证|支付|代收|代付|未到账|到账|流水|报警|卡单|投诉|ds|df|payin|payout)/i
    .test(caseText);
  const hasSupportedImage = group.messages.some(hasAiSupportedImage);
  const hasUnsupportedMedia = group.messages.some(hasAiUnsupportedMedia);

  if (hasText || hasOrderNumber || hasKeyword || (hasSupportedImage && hasText)) {
    return {
      shouldTrigger: true,
      reason: 'case 中包含可识别文本、订单信息或图片上下文。',
      mediaPolicy: hasSupportedImage ? 'images_allowed' : 'text_only',
    };
  }

  if (hasUnsupportedMedia) {
    return {
      shouldTrigger: false,
      reason: '当前 case 只有视频、语音、普通文件、贴纸或空内容，已跳过自动 AI 意图识别。',
      mediaPolicy: 'do_not_upload_video',
    };
  }

  return {
    shouldTrigger: false,
    reason: '当前 case 缺少可用于意图识别的文本上下文，已跳过自动 AI 意图识别。',
    mediaPolicy: hasSupportedImage ? 'images_allowed' : 'text_only',
  };
}
