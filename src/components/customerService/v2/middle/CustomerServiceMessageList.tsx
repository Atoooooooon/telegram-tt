import type { FC } from '../../../../lib/teact/teact';
import {
  memo, useCallback, useEffect, useMemo, useRef, useState,
} from '../../../../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import type {
  CustomerServiceCapabilityExecutionConfirmation,
  CustomerServiceCasePlaybook,
  CustomerServiceMessageGroup,
  CustomerServiceSettings,
} from '../../../../global/types/customerServiceV2';

import { registerAllCapabilities } from '../../../../global/helpers/capabilities';
import {
  buildCustomerServiceAiImagePartsFromMessages,
  buildCustomerServiceAiMultimodalContent,
  fetchCustomerServiceScenarioKnowledge,
  getCustomerServiceAiSystemPrompt,
  requestCustomerServiceAiChat,
  selectCustomerServiceAiProfile,
} from '../../../../global/helpers/customerServiceAi';
import {
  type CustomerServiceSuccessCaseRecord,
  deleteCustomerServiceSuccessCase,
  listCustomerServiceSuccessCases,
  saveCustomerServiceSuccessCase,
} from '../../../../global/helpers/customerServiceOncall';
import {
  CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
} from '../../../../global/helpers/customerServiceV2Settings';
import { getMessageSummaryText } from '../../../../global/helpers/messageSummary';
import { executeRule } from '../../../../global/helpers/ruleEngine';
import {
  selectCustomerServiceV2ContextChatId,
  selectCustomerServiceV2ContextMessageId,
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2Messages,
  selectCustomerServiceV2PendingCapabilityConfirmations,
  selectCustomerServiceV2Settings,
} from '../../../../global/selectors/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import buildStyle from '../../../../util/buildStyle';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import { formatDateTime } from '../../../../util/localization/dateFormat';
import {
  DEFAULT_GROUPING_WINDOW,
  groupCustomerServiceMessages,
} from '../helpers/groupCustomerServiceMessages';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import CompactMediaPreview, { canRenderCompactMediaPreview } from '../../../common/CompactMediaPreview';
import Icon from '../../../common/icons/Icon';
import Button from '../../../ui/Button';
import CustomerServiceSourceBadge from '../shared/CustomerServiceSourceBadge';
import AiRecommendationCard from './AiRecommendationCard';
import {
  AI_DRAFT_USER_PROMPT,
  AI_PLAYBOOK_RECOMMENDER_BUSINESS_KEY,
  AI_RECOMMENDATION_MAX_WAIT_MS,
  AI_RECOMMENDATION_SETTLE_DELAY_MS,
  type AiPlaybookRecommendation,
  type AssistantInsight,
  buildAiPlaybookRecommendationPrompt,
  buildAiRecommendationSystemPrompt,
  buildSuggestedReply,
  extractOrderNumberFromText,
  getAiRecommendationMediaSummary,
  getAiRecommendationTriggerInfo,
  getFieldValue,
  hasAiSupportedImage,
  inferProblemType,
  MAX_AI_RECOMMENDATION_IMAGE_COUNT,
  parseAiPlaybookRecommendation,
} from './CustomerServiceAiRecommendation.helpers';
import {
  type CasePlaybookRun,
  didRequestHumanConfirmation,
  didResolveCase,
  formatResolvedCaseMetadata,
  getResolvedCaseRecordFromResult,
  loadPlaybookRunHistory,
  type PlaybookRunsByGroupId,
  STANDALONE_PLAYBOOK_RUNS_ID,
  subscribePlaybookRunHistory,
  updatePlaybookRunHistory,
} from './CustomerServicePlaybookRun.helpers';
import PlaybookExecutionTimeline from './PlaybookExecutionTimeline';

import styles from './CustomerServiceMessageList.module.scss';

type OwnProps = {
  className?: string;
};

type StateProps = {
  messages: ApiMessage[];
  messageCount: number;
  activeContextChatId?: string;
  activeContextMessageId?: number;
  pendingCapabilityConfirmations: CustomerServiceCapabilityExecutionConfirmation[];
  settings?: CustomerServiceSettings;
};

type QueueFilter = 'all' | 'pending' | 'processing' | 'replied' | 'resolved';

type RecommendedPlaybook = {
  playbook: CustomerServiceCasePlaybook;
  reason: string;
  missingFields: string[];
};

const REPLY_CONTEXT_DELAY_MS = 450;
const MAX_CONTEXT_PREVIEW_COUNT = 4;
const MAX_MEDIA_PREVIEW_COUNT = 3;
const DEFAULT_QUEUE_PANE_WIDTH = 320;
const MIN_QUEUE_PANE_WIDTH = 240;
const MAX_QUEUE_PANE_WIDTH = 520;
const MIN_DETAIL_PANE_WIDTH = 360;

function normalizeFieldKey(label: string) {
  if (/订单|单号|order/i.test(label)) {
    return 'orderNumber';
  }

  return label;
}

function getInsightFieldValue(insight: AssistantInsight | undefined, fieldKey: string) {
  if (!insight) {
    return undefined;
  }

  const matchedField = insight.fields.find((field) => normalizeFieldKey(field.label) === fieldKey);
  return matchedField?.value;
}

function getCaseFieldValue(
  insight: AssistantInsight | undefined,
  fieldKey: string,
  caseText?: string,
) {
  const insightValue = getInsightFieldValue(insight, fieldKey);
  if (insightValue) {
    return insightValue;
  }

  if (fieldKey === 'orderNumber' && caseText) {
    return extractOrderNumberFromText(caseText);
  }

  return undefined;
}

function getPlaybookRequiredFieldValue(
  fieldKey: string,
  insight: AssistantInsight | undefined,
  caseText: string,
) {
  return getCaseFieldValue(insight, fieldKey, caseText);
}

function getPlaybookScope(playbook: CustomerServiceCasePlaybook) {
  return playbook.scope || 'case';
}

function canRunPlaybookWithCase(playbook: CustomerServiceCasePlaybook) {
  const scope = getPlaybookScope(playbook);
  return scope === 'case' || scope === 'both';
}

function canRunPlaybookStandalone(playbook: CustomerServiceCasePlaybook) {
  const scope = getPlaybookScope(playbook);
  return scope === 'standalone' || scope === 'both';
}

function getEnabledManualPlaybooks(settings?: CustomerServiceSettings) {
  return (settings?.casePlaybooks || [])
    .filter((playbook) => playbook.enabled && playbook.exposable !== false && playbook.manualRunnable !== false);
}

function getStatusLabel(
  groupId: string,
  repliedGroupIds: string[],
  processingGroupIds: string[],
  resolvedGroupIds: string[],
) {
  if (resolvedGroupIds.includes(groupId)) {
    return '已解决';
  }

  if (repliedGroupIds.includes(groupId)) {
    return '已回复';
  }

  if (processingGroupIds.includes(groupId)) {
    return '处理中';
  }

  return '待处理';
}

function canRenderMessageMediaPreview(message: ApiMessage) {
  return canRenderCompactMediaPreview(message.content);
}

function clampQueuePaneWidth(width: number, containerWidth?: number) {
  const maxWidth = containerWidth
    ? Math.min(MAX_QUEUE_PANE_WIDTH, Math.max(MIN_QUEUE_PANE_WIDTH, containerWidth - MIN_DETAIL_PANE_WIDTH))
    : MAX_QUEUE_PANE_WIDTH;

  return Math.min(Math.max(width, MIN_QUEUE_PANE_WIDTH), maxWidth);
}

function createVirtualPlaybookMessage(playbook: CustomerServiceCasePlaybook): ApiMessage {
  const now = Date.now();

  return {
    id: now,
    chatId: CUSTOMER_SERVICE_DEBUG_TECH_CHAT_ID,
    content: {
      text: {
        text: playbook.name,
      },
    },
    date: Math.floor(now / 1000),
    isOutgoing: false,
  };
}

const CustomerServiceMessageList: FC<OwnProps & StateProps> = ({
  className,
  messages,
  messageCount,
  activeContextChatId,
  activeContextMessageId,
  pendingCapabilityConfirmations,
  settings,
}) => {
  const {
    clearCustomerServiceV2Messages,
    openChat,
    openCustomerServiceV2Settings,
    focusMessage,
    setCustomerServiceV2Context,
    toggleCustomerServiceV2Mode,
    updateDraftReplyInfo,
    applyCustomerServiceQuickReply,
    approveCustomerServiceCapabilityExecution,
    rejectCustomerServiceCapabilityExecution,
  } = getActions();
  const lang = useLang();
  const workbenchRef = useRef<HTMLDivElement>();
  const queueResizeCleanupRef = useRef<NoneToVoidFunction>();

  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [selectedResolvedCaseId, setSelectedResolvedCaseId] = useState<string | undefined>();
  const [isDetailClosed, setIsDetailClosed] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [queuePaneWidth, setQueuePaneWidth] = useState(DEFAULT_QUEUE_PANE_WIDTH);
  const [draftReply, setDraftReply] = useState('');
  const [draftSourceGroupId, setDraftSourceGroupId] = useState<string | undefined>();
  const [repliedGroupIds, setRepliedGroupIds] = useState<string[]>([]);
  const [processingGroupIds, setProcessingGroupIds] = useState<string[]>([]);
  const [resolvedGroupIds, setResolvedGroupIds] = useState<string[]>([]);
  const [resolvedCaseRecords, setResolvedCaseRecords] = useState<CustomerServiceSuccessCaseRecord[]>([]);
  const [resolvedCaseListError, setResolvedCaseListError] = useState<string | undefined>();
  const [lookupNotesByGroupId, setLookupNotesByGroupId] = useState<Record<string, string>>({});
  const [playbookRunsByGroupId, setPlaybookRunsByGroupId] = useState<PlaybookRunsByGroupId>(
    () => loadPlaybookRunHistory(),
  );
  const [aiRecommendationByGroupId, setAiRecommendationByGroupId] = useState<Record<string, AiPlaybookRecommendation>>(
    {},
  );
  const [isRecommendingPlaybook, setIsRecommendingPlaybook] = useState(false);
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [aiDraftError, setAiDraftError] = useState<string | undefined>();
  const [aiGeneratedDraftByGroupId, setAiGeneratedDraftByGroupId] = useState<Record<string, string>>({});
  const currentMode = settings?.mode || 'oncall';
  const aiRecommendationRequestKeyRef = useRef<string>();
  const aiRecommendationAutoScheduleRef = useRef<{
    groupId?: string;
    firstChangedAt: number;
    scheduleKey?: string;
  }>();

  const refreshResolvedCaseRecords = useLastCallback(async () => {
    const result = await listCustomerServiceSuccessCases(80);

    if (!result.ok) {
      setResolvedCaseListError(result.error || '已解决 case 加载失败');
      return;
    }

    setResolvedCaseListError(undefined);
    setResolvedCaseRecords((result.records || []).filter((record) => record.recordType === 'case_resolved'));
  });

  useEffect(() => {
    void refreshResolvedCaseRecords();
  }, [refreshResolvedCaseRecords]);

  const messageGroups = useMemo<CustomerServiceMessageGroup[]>(() => {
    if (!messages.length) {
      return [];
    }

    return groupCustomerServiceMessages(messages, DEFAULT_GROUPING_WINDOW);
  }, [messages]);

  const queueGroups = useMemo(() => {
    return [...messageGroups].sort((a, b) => b.lastMessageDate - a.lastMessageDate);
  }, [messageGroups]);

  const visibleQueueGroups = useMemo(() => {
    return queueGroups.filter((group) => {
      if (queueFilter === 'resolved') {
        return false;
      }

      const status = getStatusLabel(group.id, repliedGroupIds, processingGroupIds, resolvedGroupIds);

      if (queueFilter === 'pending') {
        return status === '待处理';
      }

      if (queueFilter === 'processing') {
        return status === '处理中';
      }

      if (queueFilter === 'replied') {
        return status === '已回复';
      }

      return true;
    });
  }, [processingGroupIds, queueFilter, queueGroups, repliedGroupIds, resolvedGroupIds]);

  const selectedGroup = useMemo(() => {
    if (queueFilter === 'resolved' || isDetailClosed) {
      return undefined;
    }

    return visibleQueueGroups.find((group) => group.id === selectedGroupId)
      || visibleQueueGroups[0]
      || queueGroups[0];
  }, [isDetailClosed, queueFilter, queueGroups, selectedGroupId, visibleQueueGroups]);

  const selectedResolvedCase = useMemo(() => {
    if (queueFilter !== 'resolved' || isDetailClosed) {
      return undefined;
    }

    return resolvedCaseRecords.find((record) => record.id === selectedResolvedCaseId);
  }, [isDetailClosed, queueFilter, resolvedCaseRecords, selectedResolvedCaseId]);

  useEffect(() => {
    if (!selectedGroupId) {
      return;
    }

    if (!queueGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(undefined);
    }
  }, [queueGroups, selectedGroupId]);

  useEffect(() => {
    if (!selectedResolvedCaseId) {
      return;
    }

    if (!resolvedCaseRecords.some((record) => record.id === selectedResolvedCaseId)) {
      setSelectedResolvedCaseId(undefined);
    }
  }, [resolvedCaseRecords, selectedResolvedCaseId]);

  useEffect(() => {
    return () => {
      queueResizeCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    return subscribePlaybookRunHistory(setPlaybookRunsByGroupId);
  }, []);

  const hasLargeMessageCount = useMemo(() => messageCount > 1000, [messageCount]);

  const getLatestMessage = useCallback((group: CustomerServiceMessageGroup) => {
    return group.messages[group.messages.length - 1] || group.messages[0];
  }, []);

  const getGroupText = useCallback((group: CustomerServiceMessageGroup, limit = 8) => {
    return group.messages
      .slice(-limit)
      .map((message) => getMessageSummaryText(lang, message, undefined, true, 180))
      .filter(Boolean)
      .join('\n');
  }, [lang]);

  const getAssistantInsight = useCallback((group: CustomerServiceMessageGroup): AssistantInsight => {
    const text = getGroupText(group);
    const latestMessage = getLatestMessage(group);
    const latestPreview = latestMessage
      ? getMessageSummaryText(lang, latestMessage, undefined, true, 120)
      : '';
    const problemType = inferProblemType(text);
    const orderId = extractOrderNumberFromText(text);
    const amount = getFieldValue(text, [
      /(?:金额|付款|支付|充值)[:：\s]*(?:¥|￥|\$)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i,
      /(?:¥|￥|\$)\s*([0-9]+(?:\.[0-9]{1,2})?)/,
    ]);
    const channel = getFieldValue(text, [
      /(微信支付|支付宝|银行卡|USDT|TRC20|ERC20|PayNow|Paying)/i,
    ]);
    const missingFields = (
      problemType === '支付订单查询' && !orderId
        ? ['订单号']
        : []
    );
    const fields = [
      orderId && { label: '订单号', value: orderId },
      amount && { label: '金额', value: amount },
      channel && { label: '渠道', value: channel },
    ].filter(Boolean);
    const confidence = orderId ? 92 : missingFields.length ? 74 : 82;

    return {
      problemType,
      summary: latestPreview || text || '客户发来一条待处理消息。',
      confidence,
      fields,
      missingFields,
      needsLookup: problemType === '支付订单查询' && Boolean(orderId),
      suggestedReply: buildSuggestedReply(problemType, orderId, missingFields),
    };
  }, [getGroupText, getLatestMessage, lang]);

  const selectedInsight = useMemo(() => {
    return selectedGroup ? getAssistantInsight(selectedGroup) : undefined;
  }, [getAssistantInsight, selectedGroup]);

  const caseRunnablePlaybooks = useMemo(() => (
    getEnabledManualPlaybooks(settings).filter(canRunPlaybookWithCase)
  ), [settings]);

  const standaloneRunnablePlaybooks = useMemo(() => (
    getEnabledManualPlaybooks(settings).filter(canRunPlaybookStandalone)
  ), [settings]);

  const manualPlaybookEntries = useMemo<RecommendedPlaybook[]>(() => {
    if (!selectedGroup || !selectedInsight) {
      return [];
    }

    const caseText = getGroupText(selectedGroup, 12);
    const normalizedText = caseText.toLowerCase();

    return caseRunnablePlaybooks.map((playbook) => {
      const matcher = playbook.caseMatcher;
      const requiredFields = matcher?.requiresFields || [];
      const missingFields = requiredFields.filter((field) => (
        !getPlaybookRequiredFieldValue(field, selectedInsight, caseText)
      ));
      const keywordMatched = !matcher?.keywords?.length
        || matcher.keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()));
      const intentMatched = !matcher?.intent
        || selectedInsight.problemType.includes(matcher.intent)
        || matcher.intent.includes(selectedInsight.problemType);
      const score = (keywordMatched ? 1 : 0) + (intentMatched ? 1 : 0) + (missingFields.length ? 0 : 1);

      return {
        playbook,
        reason: score >= 2
          ? '匹配当前 case，可直接执行'
          : '可手动执行，用于调试或补充操作',
        missingFields,
      };
    }).sort((left, right) => {
      if (left.missingFields.length !== right.missingFields.length) {
        return left.missingFields.length - right.missingFields.length;
      }

      return left.playbook.name.localeCompare(right.playbook.name);
    });
  }, [caseRunnablePlaybooks, getGroupText, selectedGroup, selectedInsight]);

  const aiPlaybookRecommendation = selectedGroup
    ? aiRecommendationByGroupId[selectedGroup.id]
    : undefined;
  const aiRecommendedPlaybook = aiPlaybookRecommendation?.hasRunnablePlaybook && aiPlaybookRecommendation.playbookId
    ? caseRunnablePlaybooks.find((playbook) => playbook.id === aiPlaybookRecommendation.playbookId)
    : undefined;

  const requestAiPlaybookRecommendation = useLastCallback(async (
    group: CustomerServiceMessageGroup | undefined,
    insight: AssistantInsight | undefined,
    force = false,
  ) => {
    if (!group || !insight) {
      setIsRecommendingPlaybook(false);
      return;
    }

    const caseText = getGroupText(group, 12);
    const mediaSummary = getAiRecommendationMediaSummary(group);
    const profile = selectCustomerServiceAiProfile(settings, {
      businessKey: AI_PLAYBOOK_RECOMMENDER_BUSINESS_KEY,
    });
    const imageSourceMessages = group.messages
      .filter(hasAiSupportedImage)
      .slice(-MAX_AI_RECOMMENDATION_IMAGE_COUNT);
    const imageSourceKey = imageSourceMessages
      .map((message) => `${message.chatId}:${message.id}`)
      .join('|');
    const latestMessage = group.messages[group.messages.length - 1];
    const requestKey = [
      group.id,
      insight.problemType,
      insight.fields.map((field) => `${field.label}:${field.value}`).join('|'),
      caseRunnablePlaybooks.map((playbook) => playbook.id).join('|'),
      profile ? `${profile.id}:${profile.provider}:${profile.model}` : 'no-profile',
      imageSourceKey,
      latestMessage ? `${latestMessage.chatId}:${latestMessage.id}:${latestMessage.date}` : 'no-message',
      String(group.messages.length),
      String(caseText.length),
    ].join('::');

    if (!force && aiRecommendationRequestKeyRef.current === requestKey) {
      return;
    }

    const existing = aiRecommendationByGroupId[group.id];
    if (!force && existing?.requestKey === requestKey) {
      aiRecommendationRequestKeyRef.current = requestKey;
      return;
    }

    if (!profile) {
      setAiRecommendationByGroupId((prev) => ({
        ...prev,
        [group.id]: {
          requestKey,
          intent: insight.problemType,
          hasRunnablePlaybook: false,
          reason: '未启用外部 AI Profile，无法生成 AI 推荐。',
          error: '未启用外部 AI Profile，无法生成 AI 推荐。',
        },
      }));
      return;
    }

    aiRecommendationRequestKeyRef.current = requestKey;
    setIsRecommendingPlaybook(true);

    try {
      const imageParts = profile.provider === 'gemini'
        ? await buildCustomerServiceAiImagePartsFromMessages(imageSourceMessages, {
          maxImages: MAX_AI_RECOMMENDATION_IMAGE_COUNT,
        })
        : [];
      const scenarioKnowledge = await fetchCustomerServiceScenarioKnowledge(force);
      const userPrompt = buildAiPlaybookRecommendationPrompt({
        playbooks: caseRunnablePlaybooks,
        insight,
        caseText,
        mediaSummary,
      });
      const result = await requestCustomerServiceAiChat(profile, [
        {
          role: 'system',
          content: buildAiRecommendationSystemPrompt({
            profilePrompt: getCustomerServiceAiSystemPrompt(profile),
            knowledgeContent: scenarioKnowledge.record?.content,
            knowledgeSource: scenarioKnowledge.source,
            knowledgeUnavailable: !scenarioKnowledge.record?.content,
            knowledgeError: scenarioKnowledge.error,
          }),
        },
        {
          role: 'user',
          content: buildCustomerServiceAiMultimodalContent(userPrompt, imageParts),
        },
      ], {
        temperature: profile.temperature ?? 0.2,
        responseMimeType: profile.provider === 'gemini' ? 'application/json' : undefined,
      });

      setIsRecommendingPlaybook(false);

      if (!result.ok || !result.content) {
        setAiRecommendationByGroupId((prev) => ({
          ...prev,
          [group.id]: {
            requestKey,
            intent: insight.problemType,
            hasRunnablePlaybook: false,
            reason: result.error || 'AI 推荐失败。',
            error: result.error || 'AI 推荐失败。',
            knowledgeAvailable: Boolean(scenarioKnowledge.record?.content),
            knowledgeSource: scenarioKnowledge.source,
            knowledgeError: scenarioKnowledge.error,
          },
        }));
        return;
      }

      setAiRecommendationByGroupId((prev) => ({
        ...prev,
        [group.id]: parseAiPlaybookRecommendation(
          result.content || '',
          requestKey,
          caseRunnablePlaybooks.map((playbook) => playbook.id),
          result.finishReason,
          {
            available: Boolean(scenarioKnowledge.record?.content),
            source: scenarioKnowledge.source,
            error: scenarioKnowledge.error,
          },
        ),
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'AI 推荐失败。';
      setIsRecommendingPlaybook(false);
      setAiRecommendationByGroupId((prev) => ({
        ...prev,
        [group.id]: {
          requestKey,
          intent: insight.problemType,
          hasRunnablePlaybook: false,
          reason: errorMessage,
          error: errorMessage,
        },
      }));
    }
  });

  useEffect(() => {
    if (!selectedGroup || !selectedInsight) {
      setIsRecommendingPlaybook(false);
      return undefined;
    }

    const latestMessage = selectedGroup.messages[selectedGroup.messages.length - 1];
    const triggerInfo = getAiRecommendationTriggerInfo(selectedGroup);
    const scheduleKey = [
      selectedGroup.id,
      latestMessage ? `${latestMessage.chatId}:${latestMessage.id}:${latestMessage.date}` : 'no-message',
      selectedGroup.messages.length,
      selectedInsight.problemType,
      selectedInsight.fields.map((field) => `${field.label}:${field.value}`).join('|'),
    ].join('::');

    if (!triggerInfo.shouldTrigger) {
      const requestKey = `skip::${scheduleKey}`;
      setIsRecommendingPlaybook(false);
      setAiRecommendationByGroupId((prev) => (
        prev[selectedGroup.id]?.requestKey === requestKey
          ? prev
          : {
            ...prev,
            [selectedGroup.id]: {
              requestKey,
              intent: '暂不识别',
              hasRunnablePlaybook: false,
              reason: triggerInfo.reason,
              mediaPolicy: triggerInfo.mediaPolicy,
            },
          }
      ));
      return undefined;
    }

    const now = Date.now();
    const currentSchedule = aiRecommendationAutoScheduleRef.current;
    const firstChangedAt = currentSchedule?.groupId === selectedGroup.id
      ? currentSchedule.firstChangedAt
      : now;
    const elapsedMs = now - firstChangedAt;
    const delayMs = Math.max(
      0,
      Math.min(AI_RECOMMENDATION_SETTLE_DELAY_MS, AI_RECOMMENDATION_MAX_WAIT_MS - elapsedMs),
    );

    aiRecommendationAutoScheduleRef.current = {
      groupId: selectedGroup.id,
      firstChangedAt,
      scheduleKey,
    };

    const timeoutId = window.setTimeout(() => {
      if (aiRecommendationAutoScheduleRef.current?.scheduleKey !== scheduleKey) {
        return;
      }

      aiRecommendationAutoScheduleRef.current = {
        groupId: selectedGroup.id,
        firstChangedAt: Date.now(),
        scheduleKey,
      };
      void requestAiPlaybookRecommendation(selectedGroup, selectedInsight, false);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    requestAiPlaybookRecommendation,
    selectedGroup,
    selectedInsight,
  ]);

  useEffect(() => {
    if (!selectedGroup || !selectedInsight) {
      setDraftReply('');
      setDraftSourceGroupId(undefined);
      setAiDraftError(undefined);
      return;
    }

    if (draftSourceGroupId === selectedGroup.id) {
      return;
    }

    setDraftReply(aiGeneratedDraftByGroupId[selectedGroup.id] || selectedInsight.suggestedReply);
    setDraftSourceGroupId(selectedGroup.id);
    setAiDraftError(undefined);
  }, [aiGeneratedDraftByGroupId, draftSourceGroupId, selectedGroup, selectedInsight]);

  const handleClearAll = useLastCallback(() => {
    const tabId = getCurrentTabId();
    clearCustomerServiceV2Messages({ tabId, shouldMarkRead: true });
    setCustomerServiceV2Context({ tabId });
    setSelectedGroupId(undefined);
    setSelectedResolvedCaseId(undefined);
    setIsDetailClosed(false);
    setDraftReply('');
    setDraftSourceGroupId(undefined);
    setAiDraftError(undefined);
    setAiGeneratedDraftByGroupId({});
    setLookupNotesByGroupId({});
    updatePlaybookRunHistory(() => ({}));

    if (activeContextChatId) {
      openChat({
        id: undefined,
        tabId,
      });
    }
  });

  const handleOpenSettings = useLastCallback(() => {
    openCustomerServiceV2Settings({ tabId: getCurrentTabId() });
  });

  const handleCloseDetail = useLastCallback(() => {
    const tabId = getCurrentTabId();
    setIsDetailClosed(true);
    setSelectedResolvedCaseId(undefined);
    setCustomerServiceV2Context({ tabId });

    if (activeContextChatId) {
      openChat({
        id: undefined,
        tabId,
      });
    }
  });

  const handleToggleMode = useLastCallback(() => {
    toggleCustomerServiceV2Mode({ tabId: getCurrentTabId() });
  });

  const handleRejectCapabilityConfirmation = useLastCallback((confirmationId: string) => {
    rejectCustomerServiceCapabilityExecution({
      confirmationId,
      tabId: getCurrentTabId(),
    });
  });

  const handleApproveCapabilityConfirmation = useLastCallback((confirmationId: string) => {
    approveCustomerServiceCapabilityExecution({
      confirmationId,
      tabId: getCurrentTabId(),
    });
  });

  const handleQueueResizeStart = useLastCallback((event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    event.preventDefault();
    event.stopPropagation();
    queueResizeCleanupRef.current?.();

    const startX = event.clientX;
    const startWidth = queuePaneWidth;
    const containerWidth = workbenchRef.current?.getBoundingClientRect().width;

    document.body.classList.add('cursor-ew-resize');

    const handleMouseMove = (moveEvent: MouseEvent) => {
      setQueuePaneWidth(clampQueuePaneWidth(startWidth + moveEvent.clientX - startX, containerWidth));
    };

    const cleanup = () => {
      document.body.classList.remove('cursor-ew-resize');
      document.removeEventListener('mousemove', handleMouseMove, false);
      document.removeEventListener('mouseup', cleanup, false);
      document.removeEventListener('blur', cleanup, false);

      if (queueResizeCleanupRef.current === cleanup) {
        queueResizeCleanupRef.current = undefined;
      }
    };

    queueResizeCleanupRef.current = cleanup;
    document.addEventListener('mousemove', handleMouseMove, false);
    document.addEventListener('mouseup', cleanup, false);
    document.addEventListener('blur', cleanup, false);
  });

  const handleQueueResizeReset = useLastCallback(() => {
    setQueuePaneWidth(DEFAULT_QUEUE_PANE_WIDTH);
  });

  const handleViewContext = useLastCallback((chatId: string, messageId: number) => {
    setCustomerServiceV2Context({
      chatId,
      messageId,
      tabId: getCurrentTabId(),
    });

    openChat({
      id: chatId,
      isHalfScreen: true,
      tabId: getCurrentTabId(),
    });

    setTimeout(() => {
      focusMessage({
        chatId,
        messageId,
        isHalfScreen: true,
        tabId: getCurrentTabId(),
      });

      updateDraftReplyInfo({
        replyToMsgId: messageId,
        tabId: getCurrentTabId(),
      });
    }, 300);
  });

  const handleViewGroupContext = useLastCallback((group: CustomerServiceMessageGroup) => {
    const latestMessage = getLatestMessage(group);
    if (!latestMessage) {
      return;
    }

    setSelectedGroupId(group.id);
    setSelectedResolvedCaseId(undefined);
    setIsDetailClosed(false);
    handleViewContext(latestMessage.chatId, latestMessage.id);
  });

  const handleApplyReplyText = useLastCallback((group: CustomerServiceMessageGroup, text: string) => {
    const trimmedText = text.trim();
    const latestMessage = getLatestMessage(group);
    if (!latestMessage || !trimmedText) {
      return;
    }

    handleViewContext(latestMessage.chatId, latestMessage.id);

    window.setTimeout(() => {
      applyCustomerServiceQuickReply({
        quickReply: {
          text: trimmedText,
          mode: 'send',
        },
        tabId: getCurrentTabId(),
      });
    }, REPLY_CONTEXT_DELAY_MS);
  });

  const handleSelectGroup = useLastCallback((group: CustomerServiceMessageGroup) => {
    setSelectedGroupId(group.id);
    setSelectedResolvedCaseId(undefined);
    setIsDetailClosed(false);
  });

  const handleSelectResolvedCase = useLastCallback((recordId: string) => {
    setSelectedResolvedCaseId(recordId);
    setSelectedGroupId(undefined);
    setIsDetailClosed(false);
  });

  const markGroupResolvedLocally = useLastCallback((
    group: CustomerServiceMessageGroup,
    record?: CustomerServiceSuccessCaseRecord,
  ) => {
    setResolvedGroupIds((prev) => (prev.includes(group.id) ? prev : [...prev, group.id]));
    setRepliedGroupIds((prev) => (prev.includes(group.id) ? prev : [...prev, group.id]));
    setProcessingGroupIds((prev) => prev.filter((id) => id !== group.id));
    if (record) {
      setResolvedCaseRecords((prev) => [
        record,
        ...prev.filter((item) => item.id !== record.id),
      ]);
    }
    setAiDraftError(undefined);
  });

  const handleRunPlaybook = useLastCallback(async (
    playbook: CustomerServiceCasePlaybook,
    options?: {
      group?: CustomerServiceMessageGroup;
      insight?: AssistantInsight;
    },
  ) => {
    const targetGroup = options?.group || selectedGroup;
    const targetInsight = options?.insight || selectedInsight;
    const isStandaloneRun = !targetGroup;
    const runBucketId = targetGroup?.id || STANDALONE_PLAYBOOK_RUNS_ID;

    if (!isStandaloneRun && (!targetGroup || !targetInsight)) {
      return;
    }

    if (isStandaloneRun && !canRunPlaybookStandalone(playbook)) {
      return;
    }

    if (!isStandaloneRun && !canRunPlaybookWithCase(playbook)) {
      return;
    }

    const latestMessage = targetGroup ? getLatestMessage(targetGroup) : createVirtualPlaybookMessage(playbook);
    if (!latestMessage) {
      return;
    }

    const caseText = targetGroup ? getGroupText(targetGroup, 12) : playbook.description || playbook.name;
    const orderNumber = getCaseFieldValue(targetInsight, 'orderNumber', caseText);
    const runId = [
      playbook.id,
      runBucketId,
      Date.now(),
      Math.random().toString(36).slice(2, 8),
    ].join(':');
    const startedAt = Date.now();

    if (targetGroup) {
      setProcessingGroupIds((prev) => (prev.includes(targetGroup.id) ? prev : [...prev, targetGroup.id]));
      setLookupNotesByGroupId((prev) => ({
        ...prev,
        [targetGroup.id]: `正在执行 ${playbook.name}`,
      }));
    }
    const updateCurrentRun = (updater: (run: CasePlaybookRun) => CasePlaybookRun) => {
      updatePlaybookRunHistory((prev) => ({
        ...prev,
        [runBucketId]: (prev[runBucketId] || []).map((run) => (
          run.id === runId ? updater(run) : run
        )),
      }));
    };

    updatePlaybookRunHistory((prev) => ({
      ...prev,
      [runBucketId]: [
        {
          id: runId,
          playbookId: playbook.id,
          playbookName: playbook.name,
          stepConfigs: Object.fromEntries(
            playbook.pipeline.map((step) => [step.id, step.config || {}]),
          ),
          status: 'running',
          startedAt,
        },
        ...(prev[runBucketId] || []),
      ],
    }));

    try {
      registerAllCapabilities();

      const result = await executeRule(
        playbook,
        latestMessage,
        getGlobal(),
        getActions(),
        {
          caseId: targetGroup?.id || STANDALONE_PLAYBOOK_RUNS_ID,
          caseText,
          caseSummary: targetInsight?.summary || playbook.description || playbook.name,
          problemType: targetInsight?.problemType || playbook.caseMatcher?.intent || '主动执行',
          confidence: targetInsight?.confidence,
          fields: targetInsight?.fields || [],
          missingFields: targetInsight?.missingFields || [],
          orderNumber,
          text: caseText,
          caseMessages: targetGroup?.messages || [],
          messageIds: targetGroup ? targetGroup.messages.map((message) => message.id).join(',') : '',
        },
        {
          eventType: 'case_manual',
          allowVirtualMessage: isStandaloneRun,
          onDeferredComplete: (deferredResult) => {
            const deferredStatus: CasePlaybookRun['status'] = deferredResult.pending
              ? 'pending'
              : deferredResult.matched && !deferredResult.terminatedByFailure ? 'success' : 'failed';

            updateCurrentRun((run) => ({
              ...run,
              status: deferredStatus,
              finishedAt: deferredResult.pending ? run.finishedAt : Date.now(),
              auditLog: deferredResult.auditLog,
              result: deferredResult,
            }));

            if (targetGroup) {
              if (deferredResult.pending) {
                setLookupNotesByGroupId((prev) => ({
                  ...prev,
                  [targetGroup.id]: didRequestHumanConfirmation(deferredResult)
                    ? `${playbook.name} 等待人工确认。`
                    : `${playbook.name} 正在等待下一条机器人回复。`,
                }));
                return;
              }

              const resolvedByRule = deferredStatus === 'success' && didResolveCase(deferredResult);
              setLookupNotesByGroupId((prev) => ({
                ...prev,
                [targetGroup.id]: resolvedByRule
                  ? `${playbook.name} 已标记为已解决。`
                  : deferredStatus === 'success'
                    ? `${playbook.name} 已收到机器人回复。`
                    : `${playbook.name} 等待回复失败，请查看执行线。`,
              }));
              if (resolvedByRule) {
                markGroupResolvedLocally(targetGroup, getResolvedCaseRecordFromResult(deferredResult));
                setQueueFilter('resolved');
              } else {
                setProcessingGroupIds((prev) => prev.filter((id) => id !== targetGroup.id));
              }
            }
          },
        },
      );

      const status: CasePlaybookRun['status'] = result.pending
        ? 'pending'
        : result.matched && !result.terminatedByFailure ? 'success' : 'failed';

      updateCurrentRun((run) => ({
        ...run,
        status,
        finishedAt: Date.now(),
        auditLog: result.auditLog,
        result,
      }));
      if (targetGroup) {
        const resolvedByRule = status === 'success' && didResolveCase(result);
        setLookupNotesByGroupId((prev) => ({
          ...prev,
          [targetGroup.id]: resolvedByRule
            ? `${playbook.name} 已标记为已解决。`
            : result.pending
              ? didRequestHumanConfirmation(result)
                ? `${playbook.name} 等待人工确认。`
                : `${playbook.name} 已发起，正在等待机器人回复。`
              : status === 'success' ? `${playbook.name} 已执行。` : `${playbook.name} 执行失败，请查看执行线。`,
        }));
        if (resolvedByRule) {
          markGroupResolvedLocally(targetGroup, getResolvedCaseRecordFromResult(result));
          setQueueFilter('resolved');
        }
      }
      if (!result.pending) {
        setProcessingGroupIds((prev) => prev.filter((id) => id !== targetGroup?.id));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateCurrentRun((run) => ({
        ...run,
        status: 'failed',
        finishedAt: Date.now(),
        error: errorMessage,
      }));
      if (targetGroup) {
        setLookupNotesByGroupId((prev) => ({
          ...prev,
          [targetGroup.id]: `${playbook.name} 执行失败: ${errorMessage}`,
        }));
      }
      setProcessingGroupIds((prev) => prev.filter((id) => id !== targetGroup?.id));
    }
  });

  const handleRunCasePlaybook = useLastCallback((playbook: CustomerServiceCasePlaybook) => {
    void handleRunPlaybook(playbook, {
      group: selectedGroup,
      insight: selectedInsight,
    });
  });

  const handleRunStandalonePlaybook = useLastCallback((playbook: CustomerServiceCasePlaybook) => {
    void handleRunPlaybook(playbook);
  });

  const handleSkipSuggestedActions = useLastCallback(() => {
    if (!selectedGroup) {
      return;
    }

    setLookupNotesByGroupId((prev) => ({
      ...prev,
      [selectedGroup.id]: '已跳过建议操作，按人工判断继续处理。',
    }));
  });

  const handleRegeneratePlaybookRecommendation = useLastCallback(() => {
    void requestAiPlaybookRecommendation(selectedGroup, selectedInsight, true);
  });

  const handleRegenerateDraft = useLastCallback(async () => {
    if (!selectedGroup || !selectedInsight) {
      return;
    }

    const profile = selectCustomerServiceAiProfile(settings);
    if (!profile) {
      setDraftReply(selectedInsight.suggestedReply);
      setAiDraftError('未启用 AI Profile，已使用本地草稿。');
      return;
    }

    const contextText = getGroupText(selectedGroup, 12);
    const fieldsText = selectedInsight.fields.length
      ? selectedInsight.fields.map((field) => `${field.label}=${field.value}`).join(', ')
      : '无';
    const missingFieldsText = selectedInsight.missingFields.length
      ? selectedInsight.missingFields.join(', ')
      : '无';
    const userPrompt = AI_DRAFT_USER_PROMPT
      .replace('{problemType}', selectedInsight.problemType)
      .replace('{summary}', selectedInsight.summary)
      .replace('{fields}', fieldsText)
      .replace('{missingFields}', missingFieldsText)
      .replace('{contextText}', contextText || selectedInsight.summary);

    setIsGeneratingDraft(true);
    setAiDraftError(undefined);

    const result = await requestCustomerServiceAiChat(profile, [
      {
        role: 'system',
        content: getCustomerServiceAiSystemPrompt(profile),
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ]);

    setIsGeneratingDraft(false);

    if (!result.ok || !result.content) {
      setDraftReply(selectedInsight.suggestedReply);
      setAiDraftError(result.error || 'AI 生成失败，已使用本地草稿。');
      return;
    }

    setDraftReply(result.content);
    setDraftSourceGroupId(selectedGroup.id);
    setAiGeneratedDraftByGroupId((prev) => ({
      ...prev,
      [selectedGroup.id]: result.content || '',
    }));
  });

  const handleCopyDraft = useLastCallback(() => {
    if (!draftReply.trim() || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    void navigator.clipboard.writeText(draftReply.trim());
  });

  const handleSendDraftReply = useLastCallback(() => {
    if (!selectedGroup || !selectedInsight || !draftReply.trim()) {
      return;
    }

    const finalReply = draftReply.trim();
    handleApplyReplyText(selectedGroup, finalReply);
    setRepliedGroupIds((prev) => (prev.includes(selectedGroup.id) ? prev : [...prev, selectedGroup.id]));
    setProcessingGroupIds((prev) => prev.filter((id) => id !== selectedGroup.id));
  });

  const handleMarkResolved = useLastCallback(async () => {
    if (!selectedGroup || !selectedInsight) {
      return;
    }

    const finalReply = draftReply.trim();
    const aiDraftForCase = aiGeneratedDraftByGroupId[selectedGroup.id] || selectedInsight.suggestedReply;
    const playbookRuns = playbookRunsByGroupId[selectedGroup.id] || [];
    const result = await saveCustomerServiceSuccessCase({
      recordType: 'case_resolved',
      caseId: selectedGroup.id,
      chatId: selectedGroup.chatId,
      senderId: selectedGroup.senderId,
      messageIds: selectedGroup.messages.map((message) => message.id),
      sourceText: getGroupText(selectedGroup, 16),
      aiSummary: selectedInsight.summary,
      aiIntent: selectedInsight.problemType,
      aiDraft: aiDraftForCase,
      finalReply,
      wasEdited: Boolean(finalReply && finalReply !== aiDraftForCase.trim()),
      metadata: {
        fields: selectedInsight.fields,
        missingFields: selectedInsight.missingFields,
        confidence: selectedInsight.confidence,
        playbookRuns: playbookRuns.map((run) => ({
          playbookId: run.playbookId,
          playbookName: run.playbookName,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          auditLog: run.auditLog,
          error: run.error,
        })),
        resolvedAt: Date.now(),
      },
    });

    if (!result.ok) {
      setAiDraftError(result.error || '已解决 case 入库失败');
      return;
    }

    markGroupResolvedLocally(selectedGroup, result.record);
    setQueueFilter('resolved');
  });

  const renderQueueItem = useCallback((group: CustomerServiceMessageGroup) => {
    const latestMessage = getLatestMessage(group);
    if (!latestMessage) {
      return undefined;
    }

    const insight = getAssistantInsight(group);
    const isSelected = selectedGroup?.id === group.id;
    const isActiveGroup = activeContextChatId === group.chatId
      && group.messages.some((msg) => msg.id === activeContextMessageId);
    const status = getStatusLabel(group.id, repliedGroupIds, processingGroupIds, resolvedGroupIds);
    const time = formatDateTime(lang, new Date(group.lastMessageDate * 1000), { time: 'short' });
    const previewMediaMessage = group.messages.slice().reverse().find(canRenderMessageMediaPreview);

    return (
      <button
        key={group.id}
        type="button"
        className={buildClassName(
          styles.queueItem,
          isSelected && styles.queueItemSelected,
          isActiveGroup && styles.queueItemActiveContext,
        )}
        onClick={() => handleSelectGroup(group)}
      >
        <span className={styles.queueItemHeader}>
          <CustomerServiceSourceBadge
            message={latestMessage}
            className={styles.queueSourceBadge}
          />
          <span className={styles.queueItemTime}>{time}</span>
        </span>
        <span className={buildClassName(
          styles.queueItemPreviewRow,
          previewMediaMessage && styles.queueItemPreviewRowWithMedia,
        )}
        >
          {previewMediaMessage && (
            <CompactMediaPreview
              media={previewMediaMessage.content}
              size={42}
              className={styles.queueMediaPreview}
            />
          )}
          <span className={styles.queueItemPreview}>{insight.summary}</span>
        </span>
        <span className={styles.queueItemMeta}>
          <span className={styles.intentBadge}>{insight.problemType}</span>
          <span className={buildClassName(
            styles.statusBadge,
            status === '已解决' && styles.statusBadgeResolved,
            status === '已回复' && styles.statusBadgeReplied,
            status === '处理中' && styles.statusBadgeProcessing,
          )}
          >
            {status}
          </span>
        </span>
      </button>
    );
  }, [
    activeContextChatId,
    activeContextMessageId,
    getAssistantInsight,
    getLatestMessage,
    handleSelectGroup,
    lang,
    processingGroupIds,
    repliedGroupIds,
    resolvedGroupIds,
    selectedGroup,
  ]);

  const handleDeleteResolvedCaseRecord = useLastCallback(async (recordId: string) => {
    const result = await deleteCustomerServiceSuccessCase(recordId);
    if (!result.ok) {
      setResolvedCaseListError(result.error || '删除已解决 case 失败');
      return;
    }

    setResolvedCaseListError(undefined);
    setResolvedCaseRecords((prev) => prev.filter((record) => record.id !== recordId));
    if (selectedResolvedCaseId === recordId) {
      setSelectedResolvedCaseId(undefined);
    }
  });

  const renderResolvedCaseItem = useCallback((record: CustomerServiceSuccessCaseRecord) => {
    const time = formatDateTime(lang, new Date(record.createdAt), { time: 'short' });
    const title = record.aiIntent || '已解决 case';
    const preview = record.aiSummary || record.sourceText || record.finalReply || '已保存的处理样本';
    const isSelected = selectedResolvedCaseId === record.id;
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      handleSelectResolvedCase(record.id);
    };

    return (
      <div
        className={buildClassName(
          styles.resolvedCaseItem,
          isSelected && styles.resolvedCaseItemSelected,
        )}
        key={record.id}
        role="button"
        tabIndex={0}
        aria-label="查看已解决 case 详情"
        onClick={() => handleSelectResolvedCase(record.id)}
        onKeyDown={handleKeyDown}
      >
        <div className={styles.resolvedCaseContent}>
          <span className={styles.queueItemHeader}>
            <span className={styles.intentBadge}>{title}</span>
            <span className={styles.queueItemTime}>{time}</span>
          </span>
          <span className={styles.queueItemPreview}>{preview}</span>
          {record.finalReply && (
            <span className={styles.resolvedCaseReply}>{record.finalReply}</span>
          )}
        </div>
        <button
          type="button"
          className={styles.resolvedCaseDeleteButton}
          onClick={(event) => {
            event.stopPropagation();
            void handleDeleteResolvedCaseRecord(record.id);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          aria-label="删除已解决 case"
        >
          <Icon name="delete" />
        </button>
      </div>
    );
  }, [handleDeleteResolvedCaseRecord, handleSelectResolvedCase, lang, selectedResolvedCaseId]);

  const selectedStatus = selectedGroup
    ? getStatusLabel(selectedGroup.id, repliedGroupIds, processingGroupIds, resolvedGroupIds)
    : undefined;
  const contextMessages = selectedGroup?.messages.slice(-MAX_CONTEXT_PREVIEW_COUNT) || [];
  const contextMediaMessages = selectedGroup?.messages
    .filter(canRenderMessageMediaPreview)
    .slice(-MAX_MEDIA_PREVIEW_COUNT) || [];
  const selectedResolvedCaseMetadata = formatResolvedCaseMetadata(selectedResolvedCase?.metadata);
  const selectedResolvedCaseCreatedAt = selectedResolvedCase?.createdAt;
  const selectedResolvedCaseTime = useMemo(() => (
    selectedResolvedCaseCreatedAt
      ? formatDateTime(lang, new Date(selectedResolvedCaseCreatedAt), { date: 'short', time: 'short' })
      : undefined
  ), [lang, selectedResolvedCaseCreatedAt]);
  const lookupNote = selectedGroup ? lookupNotesByGroupId[selectedGroup.id] : undefined;
  const selectedPlaybookRuns = selectedGroup ? playbookRunsByGroupId[selectedGroup.id] || [] : [];
  const standalonePlaybookRuns = playbookRunsByGroupId[STANDALONE_PLAYBOOK_RUNS_ID] || [];
  const primaryConfirmation = pendingCapabilityConfirmations[0];

  return (
    <div className={buildClassName(styles.root, className)}>
      {hasLargeMessageCount && (
        <div className={styles.performanceHint}>
          <i className="icon icon-info" />
          <span className={styles.performanceHintText}>
            {lang('CustomerServicePerformanceHint', { count: messageCount })}
          </span>
        </div>
      )}

      {primaryConfirmation && (
        <div className={styles.confirmationBar}>
          <div className={styles.confirmationIcon}>
            <Icon name="settings" />
          </div>
          <div className={styles.confirmationText}>
            <strong className={styles.confirmationTitle}>
              AI 请求执行:
              {' '}
              {primaryConfirmation.capabilityName || primaryConfirmation.capabilityId}
            </strong>
            <span className={styles.confirmationHint}>
              {primaryConfirmation.ruleName ? `${primaryConfirmation.ruleName} · ` : ''}
              {primaryConfirmation.summary || '该能力已被设置为执行前确认。'}
            </span>
          </div>
          <div className={styles.confirmationActions}>
            <button
              type="button"
              className={styles.confirmationRejectButton}
              onClick={() => handleRejectCapabilityConfirmation(primaryConfirmation.id)}
            >
              拒绝
            </button>
            <button
              type="button"
              className={styles.confirmationApproveButton}
              onClick={() => handleApproveCapabilityConfirmation(primaryConfirmation.id)}
            >
              允许执行
            </button>
          </div>
        </div>
      )}

      <div
        className={styles.workbench}
        ref={workbenchRef}
        style={buildStyle(`--customer-service-queue-width: ${queuePaneWidth}px`)}
      >
        <aside className={styles.queuePane}>
          <div className={styles.queueHeader}>
            <div className={styles.queueHeaderText}>
              <h4 className={styles.queueTitle}>客服助手</h4>
              <span className={styles.queueSubtitle}>
                待处理
                {messageCount}
                {' '}
                条
              </span>
            </div>
            <div className={styles.queueHeaderActions}>
              <button
                type="button"
                className={buildClassName(
                  styles.modeToggleButton,
                  currentMode === 'oncall' ? styles.modeOnCall : styles.modeAssist,
                )}
                onClick={handleToggleMode}
                aria-label={currentMode === 'oncall'
                  ? lang('CustomerServiceOnCallMode')
                  : lang('CustomerServiceAssistMode')}
              >
                <Icon name={currentMode === 'oncall' ? 'phone' : 'recent'} />
                <span className={styles.modeText}>
                  {currentMode === 'oncall'
                    ? lang('CustomerServiceOnCallMode')
                    : lang('CustomerServiceAssistMode')}
                </span>
              </button>
              {messageCount > 0 && (
                <Button
                  className={styles.queueHeaderIconButton}
                  round
                  size="smaller"
                  color="translucent"
                  onClick={handleClearAll}
                  ariaLabel={lang('CustomerServiceClearMessages')}
                >
                  <Icon name="delete" />
                </Button>
              )}
              <Button
                className={styles.queueHeaderIconButton}
                round
                size="smaller"
                color="translucent"
                onClick={handleOpenSettings}
                ariaLabel={lang('CustomerServiceSettings')}
              >
                <Icon name="settings" />
              </Button>
            </div>
          </div>
          <div className={styles.queueFilters}>
            {([
              ['all', '全部'],
              ['pending', '待处理'],
              ['processing', '处理中'],
              ['replied', '已回复'],
              ['resolved', '已解决'],
            ] as Array<[QueueFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={buildClassName(styles.queueFilter, queueFilter === value && styles.queueFilterActive)}
                onClick={() => setQueueFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.queueList}>
            {queueFilter === 'resolved' ? (
              resolvedCaseRecords.length ? (
                resolvedCaseRecords.map((record) => renderResolvedCaseItem(record))
              ) : (
                <div className={styles.queueEmpty}>
                  <Icon name="check" />
                  <span>{resolvedCaseListError || '暂无已解决 case'}</span>
                </div>
              )
            ) : visibleQueueGroups.length ? (
              visibleQueueGroups.map((group) => renderQueueItem(group))
            ) : (
              <div className={styles.queueEmpty}>
                <Icon name={messageCount > 0 ? 'info' : 'message'} />
                <span>{messageCount > 0 ? '当前筛选下暂无待处理项' : lang('CustomerServiceEmpty')}</span>
              </div>
            )}
          </div>
          <div className={styles.queueFooter}>
            <span>{queueFilter === 'resolved' ? '已解决样本' : '已回复'}</span>
            <strong className={styles.queueFooterCount}>
              {queueFilter === 'resolved' ? resolvedCaseRecords.length : repliedGroupIds.length}
            </strong>
          </div>
          <button
            type="button"
            className={styles.queueResizeHandle}
            onMouseDown={handleQueueResizeStart}
            onDoubleClick={handleQueueResizeReset}
            aria-label="调整工作台侧边栏宽度"
          />
        </aside>

        <section className={styles.detailPane}>
          {selectedGroup && selectedInsight ? (
            <div className={styles.assistantWorkspace}>
              <div className={styles.detailHeader}>
                <div className={styles.detailIdentity}>
                  <CustomerServiceSourceBadge
                    message={getLatestMessage(selectedGroup)}
                    className={styles.detailSourceBadge}
                  />
                  <div className={styles.detailStats}>
                    <span className={styles.detailStatsCount}>
                      {selectedGroup.messageCount}
                      {' '}
                      条相关消息
                    </span>
                    {selectedStatus && (
                      <button
                        type="button"
                        className={buildClassName(
                          styles.statusBadge,
                          styles.statusBadgeButton,
                          selectedStatus === '已解决' && styles.statusBadgeResolved,
                          selectedStatus === '已回复' && styles.statusBadgeReplied,
                          selectedStatus === '处理中' && styles.statusBadgeProcessing,
                        )}
                        disabled={selectedStatus === '已解决'}
                        onClick={handleMarkResolved}
                        aria-label="标记为已解决"
                      >
                        {selectedStatus}
                      </button>
                    )}
                  </div>
                </div>
                <div className={styles.detailActions}>
                  <Button
                    className={styles.detailActionButton}
                    size="tiny"
                    color="translucent"
                    onClick={() => handleViewGroupContext(selectedGroup)}
                    iconName="message"
                  >
                    <span className={styles.detailActionLabel}>查看原会话</span>
                  </Button>
                  <Button
                    className={styles.detailActionButton}
                    size="tiny"
                    color="translucent"
                    onClick={handleMarkResolved}
                    iconName="check"
                  >
                    <span className={styles.detailActionLabel}>已解决</span>
                  </Button>
                  <Button
                    className={styles.detailActionButton}
                    size="tiny"
                    color="translucent"
                    onClick={handleCloseDetail}
                    iconName="close"
                  >
                    <span className={styles.detailActionLabel}>关闭</span>
                  </Button>
                </div>
              </div>

              <div className={styles.workspaceScroll}>
                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="message" />
                    <h4 className={styles.cardTitle}>客户问题</h4>
                  </div>
                  <p className={styles.summaryText}>{selectedInsight.summary}</p>
                  {contextMediaMessages.length > 0 && (
                    <div className={styles.messageMediaStrip}>
                      {contextMediaMessages.map((message) => (
                        <button
                          type="button"
                          className={styles.messageMediaButton}
                          key={`${message.chatId}-${message.id}`}
                          onClick={() => handleViewContext(message.chatId, message.id)}
                          aria-label="查看图片上下文"
                        >
                          <CompactMediaPreview
                            media={message.content}
                            size={88}
                            className={styles.messageMediaPreview}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.insightGrid}>
                    <span className={styles.insightLabel}>类型</span>
                    <strong className={styles.insightValue}>{selectedInsight.problemType}</strong>
                    <span className={styles.insightLabel}>AI 判断</span>
                    <strong className={styles.insightValue}>
                      {selectedInsight.confidence}
                      %
                    </strong>
                  </div>
                  <div className={styles.fieldList}>
                    {selectedInsight.fields.length ? selectedInsight.fields.map((field) => (
                      <span className={styles.fieldPill} key={`${field.label}-${field.value}`}>
                        {field.label}
                        :
                        {field.value}
                      </span>
                    )) : (
                      <span className={styles.fieldPillMuted}>暂无结构化字段</span>
                    )}
                  </div>
                </section>

                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="document" />
                    <h4 className={styles.cardTitle}>自动读取的上下文</h4>
                    <span className={styles.cardHint}>
                      最近
                      {contextMessages.length}
                      {' '}
                      条相关消息
                    </span>
                  </div>
                  <div className={styles.contextPreviewList}>
                    {contextMessages.map((message) => (
                      <button
                        type="button"
                        className={buildClassName(
                          styles.contextPreviewItem,
                          canRenderMessageMediaPreview(message) && styles.contextPreviewItemWithMedia,
                        )}
                        key={`${message.chatId}-${message.id}`}
                        onClick={() => handleViewContext(message.chatId, message.id)}
                      >
                        {canRenderMessageMediaPreview(message) && (
                          <CompactMediaPreview
                            media={message.content}
                            size={36}
                            className={styles.contextMediaPreview}
                          />
                        )}
                        <span className={styles.contextPreviewItemText}>
                          {getMessageSummaryText(lang, message, undefined, true, 120)}
                        </span>
                        <small className={styles.contextPreviewItemTime}>
                          {formatDateTime(lang, new Date(message.date * 1000), { time: 'short' })}
                        </small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="bots" />
                    <h4 className={styles.cardTitle}>建议操作</h4>
                    {lookupNote && <span className={styles.cardHint}>{lookupNote}</span>}
                  </div>
                  <AiRecommendationCard
                    recommendation={aiPlaybookRecommendation}
                    recommendedPlaybook={aiRecommendedPlaybook}
                    isLoading={isRecommendingPlaybook}
                    onRegenerate={handleRegeneratePlaybookRecommendation}
                    onRunPlaybook={handleRunCasePlaybook}
                  />
                  {manualPlaybookEntries.length ? (
                    <div className={styles.caseActionList}>
                      <div className={styles.caseActionGroupTitle}>手动执行</div>
                      {manualPlaybookEntries.map(({ playbook, reason, missingFields }) => (
                        <div className={styles.caseActionCard} key={playbook.id}>
                          <div className={styles.caseActionText}>
                            <strong className={styles.caseActionTitle}>{playbook.name}</strong>
                            <span className={styles.caseActionDescription}>
                              {missingFields.length
                                ? '可手动执行，执行时会从 case 原文继续提取所需字段'
                                : reason}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.caseActionButton}
                            title={missingFields.length ? '执行时会从 case 原文继续提取字段' : undefined}
                            onClick={() => handleRunCasePlaybook(playbook)}
                          >
                            执行
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className={styles.caseActionSkipButton}
                        onClick={handleSkipSuggestedActions}
                      >
                        跳过建议操作
                      </button>
                    </div>
                  ) : (
                    <div className={styles.caseActionEmpty}>
                      暂无可用 Case Playbook。可在设置的自动化中恢复 Demo。
                    </div>
                  )}

                  <PlaybookExecutionTimeline
                    runs={selectedPlaybookRuns}
                    pendingConfirmations={pendingCapabilityConfirmations}
                    onRejectConfirmation={handleRejectCapabilityConfirmation}
                    onApproveConfirmation={handleApproveCapabilityConfirmation}
                  />
                </section>
              </div>

              <div className={styles.replyDock}>
                <div className={styles.replyHeader}>
                  <div>
                    <strong className={styles.replyTitle}>回复客户</strong>
                    <span className={styles.replyHint}>
                      {aiDraftError || 'AI 草稿可直接编辑；手动标记已解决后会记录为训练样本。'}
                    </span>
                  </div>
                  <div className={styles.replyTools}>
                    <button
                      type="button"
                      className={styles.replyToolButton}
                      onClick={handleRegenerateDraft}
                      disabled={isGeneratingDraft}
                    >
                      {isGeneratingDraft ? '生成中' : '重新生成'}
                    </button>
                    <button type="button" className={styles.replyToolButton} onClick={handleCopyDraft}>
                      复制
                    </button>
                  </div>
                </div>
                <div className={styles.replyComposer}>
                  <textarea
                    className={styles.replyInput}
                    placeholder="输入或编辑回复..."
                    value={draftReply}
                    onChange={(event) => setDraftReply((event.target as HTMLTextAreaElement).value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSendDraftReply();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className={styles.replySendButton}
                    disabled={!draftReply.trim()}
                    onClick={handleSendDraftReply}
                    aria-label="发送客服回复"
                  >
                    <Icon name="send" />
                  </button>
                </div>
              </div>
            </div>
          ) : selectedResolvedCase ? (
            <div className={styles.assistantWorkspace}>
              <div className={styles.workspaceScroll}>
                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="check" />
                    <h4 className={styles.cardTitle}>
                      {selectedResolvedCase.aiIntent || '已解决 case'}
                    </h4>
                    <span className={styles.cardHint}>
                      {selectedResolvedCaseTime}
                    </span>
                  </div>
                  <div className={styles.resolvedDetailGrid}>
                    <span className={styles.insightLabel}>来源会话</span>
                    <strong className={styles.insightValue}>{selectedResolvedCase.chatId}</strong>
                    <span className={styles.insightLabel}>消息数</span>
                    <strong className={styles.insightValue}>
                      {selectedResolvedCase.messageIds?.length || 1}
                    </strong>
                    <span className={styles.insightLabel}>记录类型</span>
                    <strong className={styles.insightValue}>{selectedResolvedCase.recordType}</strong>
                    <span className={styles.insightLabel}>是否编辑</span>
                    <strong className={styles.insightValue}>{selectedResolvedCase.wasEdited ? '是' : '否'}</strong>
                  </div>
                </section>

                {selectedResolvedCase.aiSummary && (
                  <section className={styles.assistantCard}>
                    <div className={styles.cardHeader}>
                      <Icon name="message" />
                      <h4 className={styles.cardTitle}>处理摘要</h4>
                    </div>
                    <p className={styles.summaryText}>{selectedResolvedCase.aiSummary}</p>
                  </section>
                )}

                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="document" />
                    <h4 className={styles.cardTitle}>原始 Case</h4>
                  </div>
                  <div className={styles.resolvedDetailText}>
                    {selectedResolvedCase.sourceText || '未记录原始文本'}
                  </div>
                </section>

                <section className={styles.assistantCard}>
                  <div className={styles.cardHeader}>
                    <Icon name="send" />
                    <h4 className={styles.cardTitle}>最终回复</h4>
                  </div>
                  <div className={styles.resolvedDetailText}>
                    {selectedResolvedCase.finalReply || '未记录最终回复'}
                  </div>
                </section>

                {selectedResolvedCase.aiDraft && selectedResolvedCase.aiDraft !== selectedResolvedCase.finalReply && (
                  <section className={styles.assistantCard}>
                    <div className={styles.cardHeader}>
                      <Icon name="bots" />
                      <h4 className={styles.cardTitle}>AI 草稿</h4>
                    </div>
                    <div className={styles.resolvedDetailText}>
                      {selectedResolvedCase.aiDraft}
                    </div>
                  </section>
                )}

                {selectedResolvedCaseMetadata && (
                  <section className={styles.assistantCard}>
                    <div className={styles.cardHeader}>
                      <Icon name="settings" />
                      <h4 className={styles.cardTitle}>保存元数据</h4>
                    </div>
                    <pre className={styles.resolvedDetailMeta}>{selectedResolvedCaseMetadata}</pre>
                  </section>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.playbookLauncher}>
              <div className={styles.playbookLauncherHeader}>
                <Icon name={queueFilter === 'resolved' ? 'check' : 'bots'} />
                <div>
                  <strong>
                    {queueFilter === 'resolved' ? '已解决 case' : '主动执行 Playbook'}
                  </strong>
                  <span>
                    {queueFilter === 'resolved'
                      ? '左侧展示已入库的成功样本，可删除不需要保留的记录。'
                      : '无需等待客户消息，可以直接执行巡检、统计和催处理类 playbook。'}
                  </span>
                </div>
              </div>

              {queueFilter !== 'resolved' && (
                <>
                  {standaloneRunnablePlaybooks.length ? (
                    <div className={styles.caseActionList}>
                      {standaloneRunnablePlaybooks.map((playbook) => (
                        <div className={styles.caseActionCard} key={playbook.id}>
                          <div className={styles.caseActionText}>
                            <strong className={styles.caseActionTitle}>{playbook.name}</strong>
                            <span className={styles.caseActionDescription}>
                              {playbook.description || '主动执行 playbook'}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={styles.caseActionButton}
                            onClick={() => handleRunStandalonePlaybook(playbook)}
                          >
                            执行
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.caseActionEmpty}>
                      暂无可主动执行的 Playbook。可在自动化 JSON 中设置
                      {' '}
                      <code>scope</code>
                      {' '}
                      为
                      {' '}
                      <code>standalone</code>
                      。
                    </div>
                  )}

                  <PlaybookExecutionTimeline
                    runs={standalonePlaybookRuns}
                    pendingConfirmations={pendingCapabilityConfirmations}
                    onRejectConfirmation={handleRejectCapabilityConfirmation}
                    onApproveConfirmation={handleApproveCapabilityConfirmation}
                  />
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const tabId = getCurrentTabId();
    const messages = selectCustomerServiceV2Messages(global);
    const messageCount = selectCustomerServiceV2MessageCount(global);
    const activeContextChatId = selectCustomerServiceV2ContextChatId(global, tabId);
    const activeContextMessageId = selectCustomerServiceV2ContextMessageId(global, tabId);
    const pendingCapabilityConfirmations = selectCustomerServiceV2PendingCapabilityConfirmations(global);
    const settings = selectCustomerServiceV2Settings(global);

    return {
      messages,
      messageCount,
      activeContextChatId,
      activeContextMessageId,
      pendingCapabilityConfirmations,
      settings,
    };
  })(CustomerServiceMessageList),
);
