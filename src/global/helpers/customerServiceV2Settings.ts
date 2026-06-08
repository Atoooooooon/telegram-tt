import type {
  CustomerServiceCapabilityExecutionPolicies,
  CustomerServiceCasePlaybook,
  CustomerServiceExternalAiProfile,
  CustomerServiceExternalAiProfileRole,
  CustomerServiceExternalAiProvider,
  CustomerServiceExternalSettings,
  CustomerServiceOncallSettings,
  CustomerServiceQuickReply,
  CustomerServiceSettings,
  UserRule,
} from '../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';

const CUSTOMER_SERVICE_V2_SETTINGS_KEY = 'customerServiceV2Settings';
export const DEFAULT_CUSTOMER_SERVICE_AI_PROFILE_ID = 'deepseek-general';
export const DEFAULT_CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_AI_PROFILE_ID = 'gemini-playbook-recommender';
export const CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_BUSINESS_KEY = 'playbook-recommender';
export const DEFAULT_GEMINI_AI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
export const DEFAULT_GEMINI_AI_MODEL = 'gemini-2.0-flash';
export const CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID = '-4549167178';
export const DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT = [
  '你是一个稳妥的客服助手，负责根据客户消息和上下文生成可直接发送的中文回复。',
  '要求：语气简洁、礼貌、像人工客服；不要承诺未确认的结果；需要内部查询时先说明会核对；缺少关键信息时只追问必要字段。',
].join('\n');

type NormalizableSettings = {
  monitoredChatIds?: unknown;
  filteredUserIds?: unknown;
  regexFilters?: unknown;
  mode?: unknown;
  autoRead?: unknown;
  quickReplies?: unknown;
  quickReplyPanelGlobal?: unknown;
  rules?: unknown;
  casePlaybooks?: unknown;
  capabilityExecutionPolicies?: unknown;
  oncall?: unknown;
  external?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCustomerServiceQuickReplies(raw: unknown): CustomerServiceQuickReply[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<CustomerServiceQuickReply[]>((result, item) => {
    if (item === undefined || (!item && typeof item === 'object')) {
      return result;
    }

    if (typeof item === 'string') {
      const text = item.trim();
      if (text) {
        result.push({
          text,
          mode: 'send',
        });
      }
      return result;
    }

    if (isRecord(item) && typeof item.text === 'string') {
      const record = item;
      const text = item.text.trim();
      if (!text) {
        return result;
      }

      let englishText: string | undefined;
      if (typeof item.englishText === 'string') {
        englishText = item.englishText.trim();
      } else if (typeof record.textEn === 'string') {
        englishText = record.textEn.trim();
      } else if (typeof record.enText === 'string') {
        englishText = record.enText.trim();
      }

      result.push({
        text,
        mode: item.mode === 'insert' ? 'insert' : 'send',
        englishText: englishText || undefined,
      });
    }

    return result;
  }, []);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNumericString(value: unknown): string | undefined {
  const str = toTrimmedString(value);
  if (!str) return undefined;
  return /^\d+$/.test(str) ? str : undefined;
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : [...fallback];
}

function getDefaultCustomerServiceAiProfile(): CustomerServiceExternalAiProfile {
  return {
    id: DEFAULT_CUSTOMER_SERVICE_AI_PROFILE_ID,
    name: '通用客服机器人',
    provider: 'deepseek',
    enabled: false,
    role: 'general',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash',
    systemPrompt: DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 1500,
  };
}

function getDefaultCustomerServicePlaybookRecommenderAiProfile(): CustomerServiceExternalAiProfile {
  return {
    id: DEFAULT_CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_AI_PROFILE_ID,
    name: 'Gemini Playbook 推荐器',
    provider: 'gemini',
    enabled: false,
    role: 'business',
    businessKey: CUSTOMER_SERVICE_PLAYBOOK_RECOMMENDER_BUSINESS_KEY,
    baseUrl: DEFAULT_GEMINI_AI_BASE_URL,
    apiKey: '',
    model: DEFAULT_GEMINI_AI_MODEL,
    systemPrompt: DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 1500,
  };
}

export function getDefaultCustomerServiceCasePlaybooks(): CustomerServiceCasePlaybook[] {
  return [
    {
      id: 'case_va_order_feedback_demo',
      name: '收款查单 Demo: /ds 后判断 VA',
      enabled: true,
      kind: 'case_playbook',
      exposable: true,
      manualRunnable: true,
      scope: 'case',
      description: '用户发送图片和单号时,先在客户群执行 /ds,不在用户消息阶段猜 VA/QRIS。'
        + '若机器人回复显示订单成功则标记解决；若显示处理中且 VA/URL 是数字 VA,再反馈上游。',
      trigger: {
        eventType: 'case_manual',
      },
      caseMatcher: {
        intent: '支付订单查询',
        keywords: ['查单', '订单', '单号', '凭证', 'ds', '支付', 'payin'],
        requiresFields: ['orderNumber'],
      },
      pipeline: [
        {
          id: 'extract_order_number',
          capabilityId: 'text_processor',
          config: {
            inputField: 'caseText',
            outputField: 'orderNumber',
            cleanEnabled: true,
            cleanPrefixes: '/ds,/df,/d,/订单,/单号,订单号,单号,order',
            cleanTrim: true,
            extractEnabled: true,
            extractPattern: '([A-Za-z0-9][A-Za-z0-9-]{7,63})',
            extractGroupIndex: 1,
            validateEnabled: true,
            validateMinLength: 8,
            validateMaxLength: 64,
            validateNumeric: false,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'send_ds_in_customer_group',
          capabilityId: 'action_auto_reply',
          config: {
            template: '/ds {{orderNumber}}',
            replyToOriginal: true,
            typingDelayMs: 900,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'wait_ds_reply',
          capabilityId: 'wait_for_reply',
          config: {
            messageIdField: 'sentMessageId',
            timeout: 60,
            pollInterval: 5,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'check_ds_success',
          capabilityId: 'check_message',
          config: {
            variableKey: 'botReplyText',
            variableOperator: 'regex',
            variableExpectedValue:
              '((状态|status|state)\\s*[:：-]?\\s*(成功|success|successful)|\\b(success|successful)\\b)',
          },
          onSuccess: {
            gotoStep: 'resolve_ds_success',
          },
          onFailure: {
            gotoStep: 'check_ds_processing',
          },
        },
        {
          id: 'resolve_ds_success',
          capabilityId: 'action_resolve_case',
          config: {
            reason: 'VA 订单状态成功，无需继续处理',
            summaryTemplate: 'VA 订单 {{orderNumber}} 查询结果为成功',
            intentTemplate: 'VA 查单',
          },
          onSuccess: {
            stopPipeline: true,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'check_ds_processing',
          capabilityId: 'check_message',
          config: {
            variableKey: 'botReplyText',
            variableOperator: 'regex',
            variableExpectedValue: '(processing|pending|处理中|待处理|ON_PROCESS)',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'extract_va_number',
          capabilityId: 'text_processor',
          config: {
            inputField: 'botReplyText',
            outputField: 'vaNumber',
            cleanEnabled: true,
            cleanTrim: true,
            extractEnabled: true,
            extractPattern: '(?:VA/URL|VA)[:：\\s]*([0-9]{8,32})',
            extractGroupIndex: 1,
            validateEnabled: true,
            validateMinLength: 8,
            validateMaxLength: 32,
            validateNumeric: true,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'reply_customer_feedback_started',
          capabilityId: 'action_auto_reply',
          config: {
            template: '稍等，我们反馈核实一下。',
            replyToOriginal: true,
            typingDelayMs: 900,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'send_polist_to_tech_group',
          capabilityId: 'action_send_to',
          config: {
            toChatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            template: '/polist msn{{orderNumber}}',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'wait_polist_reply',
          capabilityId: 'wait_for_reply',
          config: {
            chatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            messageIdField: 'sentMessageId',
            timeout: 90,
            pollInterval: 5,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'extract_supplier_name',
          capabilityId: 'text_processor',
          config: {
            inputField: 'botReplyText',
            outputField: 'supplierName',
            cleanEnabled: true,
            cleanTrim: true,
            extractEnabled: true,
            extractPattern: '供应商[:：\\s]*([^\\n\\r]+)',
            extractGroupIndex: 1,
            validateEnabled: true,
            validateMinLength: 2,
            validateMaxLength: 120,
            validateNumeric: false,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'route_supplier_upstream_group',
          capabilityId: 'switch_route',
          config: {
            inputField: 'supplierName',
            defaultMode: 'regex',
            mergeData: true,
            casesJson: JSON.stringify([
              {
                match: 'AgungSubsidiary-子账户4-APS-+DURIAN_PAY\\(160\\)',
                gotoStep: 'prepare_upstream_feedback',
                mode: 'regex',
                data: {
                  targetChatId: '-5230502865',
                  upstreamAlias: 'DURIAN_PAY_160',
                },
              },
              {
                match: 'PakaiLinkKILAUSAFIR-PAKAILINK\\(153\\)',
                gotoStep: 'prepare_upstream_feedback',
                mode: 'regex',
                data: {
                  targetChatId: '-5213573223',
                  upstreamAlias: 'PakaiLinkKILAUSAFIR',
                },
              },
            ]),
          },
          onSuccess: {
            gotoStep: '{{switchGotoStep}}',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'prepare_upstream_feedback',
          capabilityId: 'action_send_to',
          executionPolicyByMode: {
            oncall: 'confirm',
            assist: 'auto',
          },
          config: {
            toChatId: '{{targetChatId}}',
            template: '/fs pls check va {{vaNumber}}',
            deliveryMode: 'draft_in_assist',
            mediaSource: 'case_last_media',
            requireMedia: true,
            openChatOnDraft: true,
          },
          onSuccess: {
            stopPipeline: true,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
      ],
    },
    {
      id: 'case_payout_no_funds_demo',
      name: '代付未到账 Demo: /df + /dolist',
      enabled: true,
      kind: 'case_playbook',
      exposable: true,
      manualRunnable: true,
      scope: 'case',
      description: '从当前 case 提取代付单号，在客户群回复 /df；若状态成功，到技术群执行 /dolist msn 获取上游信息。',
      trigger: {
        eventType: 'case_manual',
      },
      caseMatcher: {
        intent: '代付未到账',
        keywords: ['代付', '未到账', '没收到钱', 'no funds', 'payout', 'df', '流水', '视频'],
        requiresFields: ['orderNumber'],
      },
      pipeline: [
        {
          id: 'extract_payout_order_number',
          capabilityId: 'text_processor',
          config: {
            inputField: 'caseText',
            outputField: 'orderNumber',
            cleanEnabled: true,
            cleanPrefixes: '/df,/d,/订单,/单号,订单号,单号,payout,withdraw',
            cleanTrim: true,
            extractEnabled: true,
            extractPattern: '([A-Za-z0-9][A-Za-z0-9-]{7,63})',
            extractGroupIndex: 1,
            validateEnabled: true,
            validateMinLength: 8,
            validateMaxLength: 64,
            validateNumeric: false,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'send_df_in_customer_group',
          capabilityId: 'action_auto_reply',
          config: {
            template: '/df {{orderNumber}}',
            replyToOriginal: true,
            typingDelayMs: 900,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'wait_df_reply',
          capabilityId: 'wait_for_reply',
          config: {
            messageIdField: 'sentMessageId',
            timeout: 60,
            pollInterval: 5,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'check_df_success',
          capabilityId: 'check_message',
          config: {
            variableKey: 'botReplyText',
            variableOperator: 'regex',
            variableExpectedValue: '(success|successful|成功)',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'send_dolist_to_tech_group',
          capabilityId: 'action_send_to',
          config: {
            toChatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            template: '/dolist msn{{orderNumber}}',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'wait_dolist_reply',
          capabilityId: 'wait_for_reply',
          config: {
            chatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            messageIdField: 'sentMessageId',
            timeout: 90,
            pollInterval: 5,
          },
          onSuccess: {
            stopPipeline: true,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
      ],
    },
    {
      id: 'standalone_stuck_orders_dpgroup_demo',
      name: '卡单统计 Demo: /dpgroup',
      enabled: true,
      kind: 'case_playbook',
      exposable: true,
      manualRunnable: true,
      scope: 'standalone',
      description: '无消息时也可主动执行：发送 /dpgroup 到技术群，等待卡单统计回复，作为后续催上游 playbook 的起点。',
      trigger: {
        eventType: 'case_manual',
      },
      caseMatcher: {
        intent: '卡单统计',
        keywords: ['卡单', 'dpgroup', '催单', 'processing disburse'],
      },
      pipeline: [
        {
          id: 'send_dpgroup_to_tech_group',
          capabilityId: 'action_send_to',
          config: {
            toChatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            template: '/dpgroup',
          },
          onFailure: {
            stopPipeline: true,
          },
        },
        {
          id: 'wait_dpgroup_reply',
          capabilityId: 'wait_for_reply',
          config: {
            chatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
            messageIdField: 'sentMessageId',
            timeout: 90,
            pollInterval: 5,
          },
          onSuccess: {
            stopPipeline: true,
          },
          onFailure: {
            stopPipeline: true,
          },
        },
      ],
    },
  ];
}

export function normalizeCustomerServiceCasePlaybooks(raw: unknown): CustomerServiceCasePlaybook[] {
  if (!Array.isArray(raw)) {
    return getDefaultCustomerServiceCasePlaybooks();
  }

  if (raw.length === 0) {
    return getDefaultCustomerServiceCasePlaybooks();
  }

  const defaultPlaybook = getDefaultCustomerServiceCasePlaybooks()[0];

  return raw.filter(isRecord).map((item, index) => {
    return {
      ...item,
      id: toTrimmedString(item.id) || `case_playbook_${index + 1}`,
      name: toTrimmedString(item.name) || `Case Playbook ${index + 1}`,
      enabled: item.enabled !== false,
      kind: 'case_playbook',
      exposable: item.exposable !== false,
      manualRunnable: item.manualRunnable !== false,
      scope: item.scope === 'standalone' || item.scope === 'both' ? item.scope : 'case',
      trigger: isRecord(item.trigger)
        ? {
          ...item.trigger,
          eventType: item.trigger.eventType === 'case_manual'
            ? 'case_manual'
            : defaultPlaybook.trigger.eventType,
        }
        : defaultPlaybook.trigger,
      pipeline: Array.isArray(item.pipeline) ? item.pipeline : [],
    } as CustomerServiceCasePlaybook;
  });
}

function normalizeAiProvider(value: unknown): CustomerServiceExternalAiProvider {
  if (value === 'openai-compatible' || value === 'gemini') {
    return value;
  }

  return 'deepseek';
}

function normalizeAiProfileRole(value: unknown): CustomerServiceExternalAiProfileRole {
  return value === 'business' ? 'business' : 'general';
}

function normalizeOptionalNumber(value: unknown, fallback?: number): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeCustomerServiceExternalAiProfiles(raw: unknown): CustomerServiceExternalAiProfile[] {
  const defaultProfile = getDefaultCustomerServiceAiProfile();
  const playbookRecommenderProfile = getDefaultCustomerServicePlaybookRecommenderAiProfile();

  if (!Array.isArray(raw) || raw.length === 0) {
    return [defaultProfile, playbookRecommenderProfile];
  }

  const seenIds = new Set<string>();
  const normalized = raw.reduce<CustomerServiceExternalAiProfile[]>((result, item, index) => {
    if (!isRecord(item)) {
      return result;
    }

    const fallbackId = index === 0 ? defaultProfile.id : `ai-profile-${index + 1}`;
    let id = toTrimmedString(item.id) || fallbackId;
    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    seenIds.add(id);

    const provider = normalizeAiProvider(item.provider);
    const baseUrl = toTrimmedString(item.baseUrl)
      || (provider === 'deepseek'
        ? 'https://api.deepseek.com'
        : provider === 'gemini' ? DEFAULT_GEMINI_AI_BASE_URL : '');
    const model = toTrimmedString(item.model)
      || (provider === 'deepseek'
        ? 'deepseek-v4-flash'
        : provider === 'gemini' ? DEFAULT_GEMINI_AI_MODEL : '');

    result.push({
      id,
      name: toTrimmedString(item.name) || (index === 0 ? defaultProfile.name : `AI 配置 ${index + 1}`),
      provider,
      enabled: Boolean(item.enabled),
      role: normalizeAiProfileRole(item.role),
      businessKey: toTrimmedString(item.businessKey),
      baseUrl,
      apiKey: toTrimmedString(item.apiKey) || '',
      model,
      systemPrompt: typeof item.systemPrompt === 'string'
        ? item.systemPrompt.trim() || undefined
        : undefined,
      temperature: normalizeOptionalNumber(item.temperature, defaultProfile.temperature),
      maxTokens: normalizeOptionalNumber(item.maxTokens, defaultProfile.maxTokens),
    });

    return result;
  }, []);

  return normalized.length ? normalized : [defaultProfile, playbookRecommenderProfile];
}

export function normalizeCustomerServiceExternalSettings(raw: unknown): CustomerServiceExternalSettings {
  const source = isRecord(raw) ? raw : {};
  const aiProfiles = normalizeCustomerServiceExternalAiProfiles(source.aiProfiles);
  const defaultProfile = aiProfiles.find((profile) => profile.id === source.defaultAiProfileId)
    || aiProfiles.find((profile) => profile.role === 'general')
    || aiProfiles[0];

  return {
    defaultAiProfileId: defaultProfile?.id,
    aiProfiles,
  };
}

export function normalizeCustomerServiceOncallSettings(raw: unknown): CustomerServiceOncallSettings {
  const defaults = CUSTOMER_SERVICE_CONFIG.ONCALL_DEFAULTS;
  const source = isRecord(raw) ? raw : {};

  return {
    enabled: Boolean(source.enabled),
    staffIds: normalizeStringArray(
      source.staffIds,
      defaults.staffIds,
    ),
    newAlertChatId: toTrimmedString(source.newAlertChatId),
    newAlertThreadId: toNumericString(source.newAlertThreadId),
    holdingAlertChatId: toTrimmedString(source.holdingAlertChatId),
    holdingAlertThreadId: toNumericString(source.holdingAlertThreadId),
    highestAlertChatId: toTrimmedString(source.highestAlertChatId),
    highestAlertThreadId: toNumericString(source.highestAlertThreadId),
    processingAlertChatId: toTrimmedString(source.processingAlertChatId),
    processingAlertThreadId: toNumericString(source.processingAlertThreadId),
    resolvedAlertChatId: toTrimmedString(source.resolvedAlertChatId),
    resolvedAlertThreadId: toNumericString(source.resolvedAlertThreadId),
    firstResponseTimeoutMs: toNonNegativeNumber(
      source.firstResponseTimeoutMs,
      defaults.firstResponseTimeoutMs,
    ),
    highestEscalationTimeoutMs: toNonNegativeNumber(
      source.highestEscalationTimeoutMs,
      defaults.highestEscalationTimeoutMs,
    ),
    holdingReplyGraceTimeoutMs: toNonNegativeNumber(
      source.holdingReplyGraceTimeoutMs,
      defaults.holdingReplyGraceTimeoutMs,
    ),
    reminderCooldownMs: toNonNegativeNumber(
      source.reminderCooldownMs,
      defaults.reminderCooldownMs,
    ),
    holdingReplyPatterns: normalizeStringArray(
      source.holdingReplyPatterns,
      defaults.holdingReplyPatterns,
    ),
    resolveReplyPatterns: normalizeStringArray(
      source.resolveReplyPatterns,
      defaults.resolveReplyPatterns,
    ),
    customerResolvePatterns: normalizeStringArray(
      source.customerResolvePatterns,
      defaults.customerResolvePatterns,
    ),
  };
}

export function normalizeCapabilityExecutionPolicies(raw: unknown): CustomerServiceCapabilityExecutionPolicies {
  if (!isRecord(raw)) {
    return {};
  }

  return Object.entries(raw).reduce<CustomerServiceCapabilityExecutionPolicies>((result, [capabilityId, mode]) => {
    const normalizedCapabilityId = capabilityId.trim();
    if (!normalizedCapabilityId) {
      return result;
    }

    if (mode === 'confirm') {
      result[normalizedCapabilityId] = 'confirm';
    } else if (mode === 'auto') {
      result[normalizedCapabilityId] = 'auto';
    }

    return result;
  }, {});
}

function normalizeSettings(raw: unknown): CustomerServiceSettings | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const {
    monitoredChatIds,
    filteredUserIds,
    regexFilters,
    mode,
    autoRead,
    quickReplies,
    quickReplyPanelGlobal,
    rules,
    casePlaybooks,
    capabilityExecutionPolicies,
    oncall,
    external,
  } = raw as NormalizableSettings;

  const normalized: CustomerServiceSettings = {
    monitoredChatIds: Array.isArray(monitoredChatIds)
      ? monitoredChatIds.map(String)
      : [],
    filteredUserIds: Array.isArray(filteredUserIds)
      ? filteredUserIds.map(String)
      : [],
    regexFilters: [],
    mode: mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(autoRead),
    quickReplies: normalizeCustomerServiceQuickReplies(quickReplies),
    quickReplyPanelGlobal: Boolean(quickReplyPanelGlobal),
    rules: Array.isArray(rules) ? rules as UserRule[] : undefined,
    casePlaybooks: normalizeCustomerServiceCasePlaybooks(casePlaybooks),
    capabilityExecutionPolicies: normalizeCapabilityExecutionPolicies(capabilityExecutionPolicies),
    oncall: normalizeCustomerServiceOncallSettings(oncall),
    external: normalizeCustomerServiceExternalSettings(external),
  };

  if (Array.isArray(regexFilters)) {
    normalized.regexFilters = regexFilters.reduce<Array<{ source: string; flags: string }>>(
      (result, filter) => {
        if (!filter) {
          return result;
        }

        if (isRecord(filter) && typeof filter.source === 'string') {
          result.push({
            source: filter.source,
            flags: typeof filter.flags === 'string' ? filter.flags : '',
          });
          return result;
        }

        if (filter instanceof RegExp) {
          result.push({ source: filter.source, flags: filter.flags });
          return result;
        }

        if (typeof filter === 'string') {
          result.push({ source: filter, flags: '' });
        }

        return result;
      },
      [],
    );
  }

  return normalized;
}

function readFromStorage(key: string): CustomerServiceSettings | undefined {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return undefined;
    }

    return normalizeSettings(JSON.parse(stored));
  } catch (error) {
    return undefined;
  }
}

export function loadCustomerServiceV2SettingsFromStorage(): CustomerServiceSettings | undefined {
  return readFromStorage(CUSTOMER_SERVICE_V2_SETTINGS_KEY);
}

export function saveCustomerServiceV2SettingsToStorage(settings: CustomerServiceSettings) {
  try {
    localStorage.setItem(CUSTOMER_SERVICE_V2_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // Ignore storage errors
  }
}
