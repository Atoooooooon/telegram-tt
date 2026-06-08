/**
 * Customer Service Rule Engine
 * Capability-based pipeline execution system
 */

import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';
import type {
  ActionExecution,
  Capability,
  CapabilityInput,
  CapabilityOutput,
  CustomerServiceCapabilityExecutionConfirmation,
  CustomerServiceRuleAuditLog,
  CustomerServiceRuleAuditStep,
  CustomerServiceRuleEventType,
  CustomerServiceRuleExecutionResult,
  CustomerServiceRulesProcessResult,
  PipelineSetConfig,
  PipelineStep,
  UserRule,
} from '../types/customerServiceV2';

import { randomDelayMs, sleep } from '../../util/delays';
import { selectCustomerServiceV2Settings } from '../selectors/customerServiceV2';
import { renderTemplate } from './templateRenderer';

// Delay configuration for simulating human behavior
const ACTION_DELAY_MIN_MS = 2000;
const ACTION_DELAY_MAX_MS = 8000;
const MAX_PENDING_CAPABILITY_CONFIRMATIONS = 20;
const APPROVED_CONFIRMATION_KEYS = '__approvedCapabilityConfirmationKeys';

type PendingCapabilityConfirmationHandler = {
  approve: () => Promise<void>;
  reject: () => void;
};

const pendingCapabilityConfirmationHandlers = new Map<string, PendingCapabilityConfirmationHandler>();

function getRandomStepDelayMs(isAction = false): number {
  if (!isAction) {
    return 0;
  }

  return randomDelayMs(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS);
}

function getFirstNonEmptyString(...values: Array<string | undefined | null>): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim() !== '');
}

type RuleExecutionContext = {
  eventType: CustomerServiceRuleEventType;
  rulePhase?: UserRule['executionPhase'];
  allowVirtualMessage?: boolean;
  onDeferredComplete?: (result: CustomerServiceRuleExecutionResult) => void;
};

type PipelineExecutionContext = {
  auditId: string;
  rule: UserRule;
  eventType: CustomerServiceRuleEventType;
  startedAt: number;
  onDeferredComplete?: (result: CustomerServiceRuleExecutionResult) => void;
};

function createCapabilityConfirmationId(
  message: ApiMessage,
  capabilityId: string,
  executionSource: CustomerServiceCapabilityExecutionConfirmation['executionSource'],
  stepId?: string,
): string {
  return [
    'capability',
    executionSource,
    capabilityId,
    stepId || 'action',
    message.chatId,
    message.id,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

function createCapabilityExecutionKey(
  message: ApiMessage,
  capabilityId: string,
  executionSource: CustomerServiceCapabilityExecutionConfirmation['executionSource'],
  stepId?: string,
): string {
  return [
    executionSource,
    capabilityId,
    stepId || 'action',
    message.chatId,
    message.id,
  ].join(':');
}

function getApprovedConfirmationKeys(pipelineData: Record<string, any>): Record<string, true> {
  const approvedKeys = pipelineData[APPROVED_CONFIRMATION_KEYS];

  if (!approvedKeys || typeof approvedKeys !== 'object' || Array.isArray(approvedKeys)) {
    return {};
  }

  return approvedKeys as Record<string, true>;
}

function isCapabilityExecutionApproved(pipelineData: Record<string, any>, executionKey: string): boolean {
  return Boolean(getApprovedConfirmationKeys(pipelineData)[executionKey]);
}

function markCapabilityExecutionApproved(pipelineData: Record<string, any>, executionKey: string): void {
  pipelineData[APPROVED_CONFIRMATION_KEYS] = {
    ...getApprovedConfirmationKeys(pipelineData),
    [executionKey]: true,
  };
}

function shouldConfirmExecution(executionPolicy?: 'auto' | 'confirm'): boolean {
  return executionPolicy === 'confirm';
}

function resolveExecutionPolicy(
  global: GlobalState,
  executionPolicy?: 'auto' | 'confirm',
  executionPolicyByMode?: Partial<Record<'oncall' | 'assist', 'auto' | 'confirm'>>,
): 'auto' | 'confirm' | undefined {
  const mode = global.customerServiceV2?.settings?.mode;
  return mode ? executionPolicyByMode?.[mode] || executionPolicy : executionPolicy;
}

function getActionExecutionPolicy(
  actionExecution: ActionExecution,
  global: GlobalState,
): 'auto' | 'confirm' | undefined {
  return typeof actionExecution === 'object'
    ? resolveExecutionPolicy(global, actionExecution.executionPolicy, actionExecution.executionPolicyByMode)
    : undefined;
}

async function upsertPendingCapabilityConfirmation(
  confirmation: CustomerServiceCapabilityExecutionConfirmation,
): Promise<void> {
  const { getGlobal, setGlobal } = await import('../index');
  let global = getGlobal();
  const currentCs = global.customerServiceV2 || {
    messages: [],
    messagesByChatId: {},
    lastSyncTimestamp: Date.now(),
    messageCount: 0,
  };
  const confirmations = currentCs.pendingCapabilityConfirmations || [];
  const nextConfirmations = [
    confirmation,
    ...confirmations.filter((item) => item.id !== confirmation.id),
  ].slice(0, MAX_PENDING_CAPABILITY_CONFIRMATIONS);

  global = {
    ...global,
    customerServiceV2: {
      ...currentCs,
      pendingCapabilityConfirmations: nextConfirmations,
      lastSyncTimestamp: Date.now(),
    },
  };
  setGlobal(global);
}

async function removePendingCapabilityConfirmation(confirmationId: string): Promise<void> {
  const { getGlobal, setGlobal } = await import('../index');
  let global = getGlobal();
  const currentCs = global.customerServiceV2;

  if (!currentCs?.pendingCapabilityConfirmations?.length) {
    return;
  }

  const nextConfirmations = currentCs.pendingCapabilityConfirmations.filter((item) => item.id !== confirmationId);

  global = {
    ...global,
    customerServiceV2: {
      ...currentCs,
      pendingCapabilityConfirmations: nextConfirmations.length ? nextConfirmations : undefined,
      lastSyncTimestamp: Date.now(),
    },
  };
  setGlobal(global);
}

function registerCapabilityConfirmation(
  confirmation: CustomerServiceCapabilityExecutionConfirmation,
  handler: PendingCapabilityConfirmationHandler,
): void {
  pendingCapabilityConfirmationHandlers.set(confirmation.id, handler);
  void upsertPendingCapabilityConfirmation(confirmation);
}

export async function approveCustomerServiceCapabilityConfirmation(confirmationId: string): Promise<boolean> {
  const handler = pendingCapabilityConfirmationHandlers.get(confirmationId);
  pendingCapabilityConfirmationHandlers.delete(confirmationId);
  await removePendingCapabilityConfirmation(confirmationId);

  if (!handler) {
    return false;
  }

  await handler.approve();
  return true;
}

export function rejectCustomerServiceCapabilityConfirmation(confirmationId: string): void {
  const handler = pendingCapabilityConfirmationHandlers.get(confirmationId);
  pendingCapabilityConfirmationHandlers.delete(confirmationId);
  handler?.reject();
  void removePendingCapabilityConfirmation(confirmationId);
}

function buildCapabilityConfirmation(params: {
  capability: Capability;
  executionSource: CustomerServiceCapabilityExecutionConfirmation['executionSource'];
  message: ApiMessage;
  pipelineData: Record<string, any>;
  ruleId?: string;
  ruleName?: string;
  stepId?: string;
}): CustomerServiceCapabilityExecutionConfirmation {
  return {
    id: createCapabilityConfirmationId(
      params.message,
      params.capability.id,
      params.executionSource,
      params.stepId,
    ),
    createdAt: Date.now(),
    chatId: params.message.chatId,
    messageId: params.message.id,
    capabilityId: params.capability.id,
    capabilityName: params.capability.name,
    capabilityType: params.capability.type,
    executionSource: params.executionSource,
    ruleId: params.ruleId,
    ruleName: params.ruleName,
    stepId: params.stepId,
    summary: getFirstNonEmptyString(
      typeof params.pipelineData.text === 'string' ? params.pipelineData.text : undefined,
      typeof params.pipelineData.previewText === 'string' ? params.pipelineData.previewText : undefined,
    ),
  };
}

function createAuditId(rule: UserRule, message: ApiMessage): string {
  return [
    rule.id || 'rule',
    message.chatId,
    message.id,
    Date.now(),
    Math.random().toString(36).slice(2, 8),
  ].join(':');
}

function getPipelineDataKeys(pipelineData: Record<string, any>): string[] {
  return Object.keys(pipelineData)
    .filter((key) => key !== 'message' && key !== 'executionLog' && key !== 'auditSteps')
    .sort();
}

async function buildInitialPipelineData(
  message: ApiMessage,
  global: GlobalState,
  initialPipelineData?: Record<string, any>,
  executionContext?: RuleExecutionContext,
) {
  const [
    { selectChat, selectPeer, selectSender },
    { getPeerTitle, getPeerFullTitle },
    { getMessageText, getMessageStatefulContent },
    { getMessageSummaryText },
    { getTranslationFn },
  ] = await Promise.all([
    import('../selectors'),
    import('./peers'),
    import('./messages'),
    import('./messageSummary'),
    import('../../util/localization'),
  ]);

  const lang = getTranslationFn();
  const chat = selectChat(global, message.chatId);
  const chatPeer = selectPeer(global, message.chatId) || chat;
  const sender = selectSender(global, message);
  const isSenderBot = sender && 'type' in sender && sender.type === 'userTypeBot' ? 'true' : 'false';
  const rawText = getMessageText(message)?.text;
  const previewText = getMessageSummaryText(lang, message, getMessageStatefulContent(global, message));

  const chatTitle = getFirstNonEmptyString(
    typeof initialPipelineData?.chatTitle === 'string' ? initialPipelineData.chatTitle : undefined,
    typeof initialPipelineData?.chatName === 'string' ? initialPipelineData.chatName : undefined,
    chatPeer ? getPeerTitle(lang, chatPeer) : undefined,
    chat?.title,
    message.chatId,
  ) || '';

  const senderName = getFirstNonEmptyString(
    typeof initialPipelineData?.senderName === 'string' ? initialPipelineData.senderName : undefined,
    typeof initialPipelineData?.sender === 'string' ? initialPipelineData.sender : undefined,
    sender ? getPeerFullTitle(lang, sender) : undefined,
    sender ? getPeerTitle(lang, sender) : undefined,
    message.senderId,
  ) || '';

  const text = getFirstNonEmptyString(
    typeof initialPipelineData?.text === 'string' ? initialPipelineData.text : undefined,
    rawText,
    previewText,
  ) || '';

  const resolvedPreviewText = getFirstNonEmptyString(
    typeof initialPipelineData?.previewText === 'string' ? initialPipelineData.previewText : undefined,
    previewText,
    rawText,
  ) || '';

  return {
    ...initialPipelineData,
    __allowVirtualMessage: Boolean(executionContext?.allowVirtualMessage || initialPipelineData?.__allowVirtualMessage),
    message,
    chatId: message.chatId,
    chatTitle,
    chatName: chatTitle,
    messageId: message.id,
    senderId: message.senderId || '',
    isSenderBot,
    sender: senderName,
    senderName,
    text,
    previewText: resolvedPreviewText,
    date: typeof message.date === 'number' ? message.date : '',
    createdAt: typeof message.date === 'number' ? message.date * 1000 : Date.now(),
    eventType: executionContext?.eventType || initialPipelineData?.eventType || '',
    rulePhase: executionContext?.rulePhase || initialPipelineData?.rulePhase || '',
    executionLog: [],
    auditSteps: [],
  } as Record<string, any>;
}

// Capability registry
const capabilityRegistry = new Map<string, Capability>();

/**
 * Deferred task for async capabilities
 */
type DeferredTask = {
  delay: number;
  checkFn: () => Promise<boolean | { success: boolean; data?: Record<string, any> }>;
  pipeline: PipelineStep[];
  stepIndex: number;
  message: ApiMessage;
  actions: any;
  pipelineData: Record<string, any>;
  ruleMatched: boolean;
  ruleHandled: boolean;
  executionContext?: PipelineExecutionContext;
};

function updateDeferredAuditStep(
  pipelineData: Record<string, any>,
  stepId: string,
  success: boolean,
  resultData?: Record<string, any>,
): void {
  if (!Array.isArray(pipelineData.auditSteps)) {
    return;
  }

  for (let index = pipelineData.auditSteps.length - 1; index >= 0; index--) {
    const step = pipelineData.auditSteps[index] as CustomerServiceRuleAuditStep | undefined;
    if (!step || step.stepId !== stepId || !step.pending) {
      continue;
    }

    pipelineData.auditSteps[index] = {
      ...step,
      finishedAt: Date.now(),
      success,
      pending: false,
      outputKeys: resultData ? Object.keys(resultData).sort() : step.outputKeys,
    };
    return;
  }
}

function buildDeferredRuleExecutionResult(params: {
  task: DeferredTask;
  success: boolean;
  pending: boolean;
  terminatedByFailure: boolean;
}): CustomerServiceRuleExecutionResult | undefined {
  const { executionContext } = params.task;

  if (!executionContext) {
    return undefined;
  }

  const handled = params.task.ruleHandled && !params.terminatedByFailure;
  const skipPostProcessing = handled && Boolean(executionContext.rule.skipPostProcessing);
  const matched = params.success && !params.terminatedByFailure;

  return {
    matched,
    handled,
    pending: params.pending,
    terminatedByFailure: params.terminatedByFailure,
    skipPostProcessing,
    pipelineData: params.task.pipelineData,
    auditLog: buildRuleAuditLog({
      auditId: executionContext.auditId,
      rule: executionContext.rule,
      message: params.task.message,
      eventType: executionContext.eventType,
      startedAt: executionContext.startedAt,
      pipelineData: params.task.pipelineData,
      matched,
      handled,
      pending: params.pending,
      terminatedByFailure: params.terminatedByFailure,
      skipPostProcessing,
    }),
  };
}

/**
 * Register a deferred task for async execution
 * The task will execute after the specified delay and continue the pipeline
 */
function registerDeferredTask(task: DeferredTask): void {
  setTimeout(async () => {
    try {
      logExecution(task.pipelineData, `[Async] Executing deferred task for message ${task.message.id}`);

      // Execute the check function to get success/failure
      const checkResult = await task.checkFn();
      const success = typeof checkResult === 'boolean' ? checkResult : checkResult.success;
      const resultData = typeof checkResult === 'boolean' ? undefined : checkResult.data;
      const currentStep = task.pipeline[task.stepIndex];
      const stepId = currentStep.id || String(task.stepIndex + 1);

      logExecution(task.pipelineData, `[Async] Check result: ${success ? 'success' : 'failure'}`);

      // Get fresh global state
      const { getGlobal } = await import('../index');
      const freshGlobal = getGlobal();

      // Update pipeline data with result data if available
      if (resultData) {
        Object.assign(task.pipelineData, resultData);
        logExecution(task.pipelineData, `[Async] Step Output: ${JSON.stringify(resultData)}`, stepId);
      }

      updateDeferredAuditStep(task.pipelineData, stepId, success, resultData);

      const { nextStepIndex, shouldContinue } = await handleRouting(
        success,
        currentStep,
        task.pipeline,
        task.stepIndex,
        task.message,
        freshGlobal,
        task.actions,
        task.pipelineData,
      );

      const terminatedByFailure = !success && Boolean(currentStep.onFailure?.stopPipeline);

      // Continue pipeline execution if needed
      if (shouldContinue && nextStepIndex !== undefined && nextStepIndex < task.pipeline.length) {
        logExecution(task.pipelineData, `[Async] Continuing pipeline from step ${nextStepIndex + 1}`);

        const continuationResult = await executePipelineInternal(
          task.pipeline,
          nextStepIndex,
          task.message,
          freshGlobal,
          task.actions,
          task.pipelineData,
          task.executionContext,
        );

        if (continuationResult.pending) {
          const progressResult = buildDeferredRuleExecutionResult({
            task: {
              ...task,
              ruleMatched: task.ruleMatched || continuationResult.ruleMatched,
              ruleHandled: task.ruleHandled || continuationResult.ruleHandled,
            },
            success: success || continuationResult.ruleMatched,
            pending: true,
            terminatedByFailure: terminatedByFailure || continuationResult.terminatedByFailure,
          });
          if (progressResult) {
            task.executionContext?.onDeferredComplete?.(progressResult);
          }
        } else {
          const deferredResult = buildDeferredRuleExecutionResult({
            task: {
              ...task,
              ruleMatched: task.ruleMatched || continuationResult.ruleMatched,
              ruleHandled: task.ruleHandled || continuationResult.ruleHandled,
            },
            success: success || continuationResult.ruleMatched,
            pending: false,
            terminatedByFailure: terminatedByFailure || continuationResult.terminatedByFailure,
          });
          if (deferredResult) {
            task.executionContext?.onDeferredComplete?.(deferredResult);
          }
        }
        return;
      }

      const deferredResult = buildDeferredRuleExecutionResult({
        task,
        success,
        pending: false,
        terminatedByFailure,
      });
      if (deferredResult) {
        task.executionContext?.onDeferredComplete?.(deferredResult);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[RuleEngine:Async] Deferred task failed:', error);
    }
  }, task.delay);
}

/**
 * Register a capability
 */
export function registerCapability(capability: Capability): void {
  capabilityRegistry.set(capability.id, capability);
}

/**
 * Get registered capability by ID
 */
export function getCapability(capabilityId: string): Capability | undefined {
  return capabilityRegistry.get(capabilityId);
}

/**
 * Get all registered capability IDs
 */
export function getAllRegisteredCapabilityIds(): string[] {
  return Array.from(capabilityRegistry.keys());
}

/**
 * Check if a capability is registered
 */
export function isCapabilityRegistered(capabilityId: string): boolean {
  return capabilityRegistry.has(capabilityId);
}

/**
 * Validate that every capability referenced in provided rules is registered
 */
export function validateRuleCapabilities(rules?: UserRule[], context: string = 'rules'): void {
  if (!rules?.length) {
    return;
  }

  const missing = new Set<string>();

  function ensureCapabilityRegistered(capabilityId: string | undefined, source: string) {
    if (!capabilityId) {
      return;
    }
    if (!isCapabilityRegistered(capabilityId)) {
      missing.add(`${capabilityId} @ ${source}`);
    }
  }

  rules.forEach((rule) => {
    rule.pipeline.forEach((step, index) => {
      const source = `${rule.id || 'rule'}#${step.id || index + 1}`;
      ensureCapabilityRegistered(step.capabilityId, source);

      if (step.onSuccess?.executeAction) {
        const actionId = typeof step.onSuccess.executeAction === 'string'
          ? step.onSuccess.executeAction
          : step.onSuccess.executeAction.capabilityId;
        ensureCapabilityRegistered(actionId, `${source}:onSuccess`);
      }

      if (step.onFailure?.executeAction) {
        const actionId = typeof step.onFailure.executeAction === 'string'
          ? step.onFailure.executeAction
          : step.onFailure.executeAction.capabilityId;
        ensureCapabilityRegistered(actionId, `${source}:onFailure`);
      }
    });
  });

  if (missing.size > 0) {
    throw new Error(`[RuleEngine] Unregistered capabilities in ${context}: ${Array.from(missing).join(', ')}`);
  }
}

/**
 * Log execution message to pipelineData
 */
function logExecution(pipelineData: Record<string, any>, message: string, stepId?: string) {
  if (!pipelineData.executionLog) {
    pipelineData.executionLog = [];
  }
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
  const stepInfo = stepId ? ` [Step: ${stepId}]` : '';
  const logEntry = `[${timestamp}]${stepInfo} ${message}`;
  pipelineData.executionLog.push(logEntry);
  // eslint-disable-next-line no-console
  console.log(`[RuleEngine]${stepInfo} ${message}`);
}

function appendAuditStep(pipelineData: Record<string, any>, step: CustomerServiceRuleAuditStep): void {
  if (!Array.isArray(pipelineData.auditSteps)) {
    pipelineData.auditSteps = [];
  }

  pipelineData.auditSteps.push(step);
}

function markOutputHandled(
  capability: Capability,
  result: CapabilityOutput,
): boolean {
  return result.handled ?? (capability.type === 'action' && result.success);
}

function renderPipelineSetValue(value: unknown, pipelineData: Record<string, any>): unknown {
  if (typeof value === 'string') {
    return renderTemplate(value, pipelineData);
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderPipelineSetValue(item, pipelineData));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        renderPipelineSetValue(nestedValue, pipelineData),
      ]),
    );
  }

  return value;
}

function applyPipelineSet(
  pipelineData: Record<string, any>,
  setConfig: PipelineSetConfig | undefined,
): string[] {
  if (!setConfig || Object.keys(setConfig).length === 0) {
    return [];
  }

  const updatedKeys: string[] = [];

  Object.entries(setConfig).forEach(([key, value]) => {
    pipelineData[key] = renderPipelineSetValue(value, pipelineData);
    updatedKeys.push(key);
  });

  return updatedKeys;
}

function buildRuleAuditLog(params: {
  auditId: string;
  rule: UserRule;
  message: ApiMessage;
  eventType: CustomerServiceRuleEventType;
  startedAt: number;
  pipelineData: Record<string, any>;
  matched: boolean;
  handled: boolean;
  pending: boolean;
  terminatedByFailure: boolean;
  skipPostProcessing: boolean;
  error?: string;
}): CustomerServiceRuleAuditLog {
  const executionLog = Array.isArray(params.pipelineData.executionLog)
    ? params.pipelineData.executionLog.map(String)
    : [];
  const steps = Array.isArray(params.pipelineData.auditSteps)
    ? params.pipelineData.auditSteps as CustomerServiceRuleAuditStep[]
    : [];

  return {
    id: params.auditId,
    ruleId: params.rule.id,
    ruleName: params.rule.name,
    chatId: params.message.chatId,
    messageId: params.message.id,
    eventType: params.eventType,
    rulePhase: params.rule.executionPhase,
    startedAt: params.startedAt,
    finishedAt: Date.now(),
    matched: params.matched,
    handled: params.handled,
    pending: params.pending,
    terminatedByFailure: params.terminatedByFailure,
    skipPostProcessing: params.skipPostProcessing,
    error: params.error,
    executionLog,
    steps,
    pipelineDataKeys: getPipelineDataKeys(params.pipelineData),
  };
}

function buildPipelineRuleExecutionResult(params: {
  executionContext: PipelineExecutionContext;
  message: ApiMessage;
  pipelineData: Record<string, any>;
  ruleMatched: boolean;
  ruleHandled: boolean;
  pending: boolean;
  terminatedByFailure: boolean;
  error?: string;
}): CustomerServiceRuleExecutionResult {
  const handled = params.ruleHandled && !params.terminatedByFailure;
  const skipPostProcessing = handled && Boolean(params.executionContext.rule.skipPostProcessing);
  const matched = params.ruleMatched && !params.terminatedByFailure;

  return {
    matched,
    handled,
    pending: params.pending,
    terminatedByFailure: params.terminatedByFailure,
    skipPostProcessing,
    pipelineData: params.pipelineData,
    auditLog: buildRuleAuditLog({
      auditId: params.executionContext.auditId,
      rule: params.executionContext.rule,
      message: params.message,
      eventType: params.executionContext.eventType,
      startedAt: params.executionContext.startedAt,
      pipelineData: params.pipelineData,
      matched,
      handled,
      pending: params.pending,
      terminatedByFailure: params.terminatedByFailure,
      skipPostProcessing,
      error: params.error,
    }),
  };
}

/**
 * Handle routing logic after a step execution
 */
async function handleRouting(
  success: boolean,
  step: PipelineStep,
  pipeline: PipelineStep[],
  currentIndex: number,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
  pipelineData: Record<string, any>,
): Promise<{ nextStepIndex?: number; shouldContinue: boolean; actionHandled: boolean; actionPending: boolean }> {
  const routing = success ? step.onSuccess : step.onFailure;
  let nextStepIndex = currentIndex + 1;
  let shouldContinue = true;
  let actionHandled = false;
  let actionPending = false;

  const stepSetKeys = applyPipelineSet(pipelineData, step.set);
  if (stepSetKeys.length > 0) {
    logExecution(pipelineData, `Applied step set keys: ${stepSetKeys.sort().join(', ')}`);
  }

  const routeSetKeys = applyPipelineSet(pipelineData, routing?.set);
  if (routeSetKeys.length > 0) {
    logExecution(pipelineData, `Applied route set keys: ${routeSetKeys.sort().join(', ')}`);
  }

  const input: CapabilityInput = {
    message,
    config: step.config,
    global,
    actions,
    pipelineData,
    step,
  };

  if (routing?.executeAction) {
    const actionResult = await executeAction(routing.executeAction, input);
    if (actionResult?.data?.__capabilityConfirmationPending) {
      actionPending = true;
      shouldContinue = false;
    }
    actionHandled = Boolean(actionResult?.success && (actionResult.handled ?? true));
  }

  if (routing?.gotoStep) {
    const targetStepId = renderTemplate(routing.gotoStep, pipelineData).trim();
    const targetIndex = pipeline.findIndex((s) => s.id === targetStepId);
    if (targetIndex !== -1) {
      nextStepIndex = targetIndex;
    } else {
      logExecution(pipelineData, `Routing error: Step "${targetStepId || routing.gotoStep}" not found`);
    }
  }

  // Consistent stop logic
  if (routing?.stopPipeline) {
    shouldContinue = false;
  }

  return {
    nextStepIndex,
    shouldContinue,
    actionHandled,
    actionPending,
  };
}

/**
 * Internal common pipeline execution logic
 */
async function executePipelineInternal(
  pipeline: PipelineStep[],
  startIndex: number,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
  pipelineData: Record<string, any>,
  executionContext?: PipelineExecutionContext,
): Promise<{ ruleMatched: boolean; ruleHandled: boolean; pending: boolean; terminatedByFailure: boolean }> {
  let currentStepIndex = startIndex;
  let ruleMatched = false;
  let ruleHandled = false;
  let pending = false;
  let terminatedByFailure = false;

  while (currentStepIndex < pipeline.length) {
    const step = pipeline[currentStepIndex];
    const stepId = step.id || String(currentStepIndex + 1);
    const capability = capabilityRegistry.get(step.capabilityId);

    if (!capability) {
      logExecution(pipelineData, `Error: Capability not found: ${step.capabilityId}`, stepId);
      terminatedByFailure = true;
      break;
    }

    logExecution(pipelineData, `Capability: ${capability.name}`, stepId);
    const auditStep: CustomerServiceRuleAuditStep = {
      stepId,
      capabilityId: step.capabilityId,
      capabilityName: capability.name,
      startedAt: Date.now(),
    };

    try {
      const capabilityExecutionKey = createCapabilityExecutionKey(
        message,
        capability.id,
        'pipeline_step',
        stepId,
      );

      if (
        executionContext
        &&
        shouldConfirmExecution(resolveExecutionPolicy(global, step.executionPolicy, step.executionPolicyByMode))
        && !isCapabilityExecutionApproved(pipelineData, capabilityExecutionKey)
      ) {
        const confirmation = buildCapabilityConfirmation({
          capability,
          executionSource: 'pipeline_step',
          message,
          pipelineData,
          ruleId: typeof pipelineData.ruleId === 'string' ? pipelineData.ruleId : undefined,
          ruleName: typeof pipelineData.ruleName === 'string' ? pipelineData.ruleName : undefined,
          stepId,
        });

        logExecution(pipelineData, `Waiting for human confirmation before ${capability.name}`, stepId);
        auditStep.finishedAt = Date.now();
        auditStep.success = true;
        auditStep.handled = false;
        auditStep.pending = true;
        appendAuditStep(pipelineData, auditStep);

        registerCapabilityConfirmation(confirmation, {
          approve: async () => {
            const { getGlobal } = await import('../index');
            const freshGlobal = getGlobal();
            const resumePipelineData = { ...pipelineData };
            markCapabilityExecutionApproved(resumePipelineData, capabilityExecutionKey);
            logExecution(resumePipelineData, `Human approved capability: ${capability.name}`, stepId);
            const continuationResult = await executePipelineInternal(
              pipeline,
              currentStepIndex,
              message,
              freshGlobal,
              actions,
              resumePipelineData,
              executionContext,
            );
            if (continuationResult.pending) {
              executionContext.onDeferredComplete?.(buildPipelineRuleExecutionResult({
                executionContext,
                message,
                pipelineData: resumePipelineData,
                ruleMatched: ruleMatched || continuationResult.ruleMatched,
                ruleHandled: ruleHandled || continuationResult.ruleHandled,
                pending: true,
                terminatedByFailure: continuationResult.terminatedByFailure,
              }));
            } else {
              executionContext.onDeferredComplete?.(buildPipelineRuleExecutionResult({
                executionContext,
                message,
                pipelineData: resumePipelineData,
                ruleMatched: ruleMatched || continuationResult.ruleMatched,
                ruleHandled: ruleHandled || continuationResult.ruleHandled,
                pending: false,
                terminatedByFailure: continuationResult.terminatedByFailure,
              }));
            }
          },
          reject: () => {
            logExecution(pipelineData, `Human rejected capability: ${capability.name}`, stepId);
            executionContext.onDeferredComplete?.(buildPipelineRuleExecutionResult({
              executionContext,
              message,
              pipelineData,
              ruleMatched,
              ruleHandled,
              pending: false,
              terminatedByFailure: true,
              error: `Human rejected capability: ${capability.name}`,
            }));
          },
        });

        return {
          ruleMatched: true,
          ruleHandled,
          pending: true,
          terminatedByFailure,
        };
      }

      // Human-like delay only for action steps that may call Telegram APIs
      const delayMs = getRandomStepDelayMs(capability.type === 'action');
      if (delayMs > 0) {
        logExecution(pipelineData, `Simulating human delay: ${delayMs}ms`, stepId);
        await sleep(delayMs);
      }

      // --- Sanity Check: Ensure message still exists in GlobalState ---
      const { getGlobal } = await import('../index');
      const { selectChatMessage } = await import('../selectors');
      const freshGlobal = getGlobal();
      const allowVirtualMessage = pipelineData.__allowVirtualMessage === true;
      const currentMessage = allowVirtualMessage
        ? message
        : selectChatMessage(freshGlobal, message.chatId, message.id);

      if (!currentMessage) {
        logExecution(pipelineData, 'Abort: Message was deleted by user during processing.', stepId);
        auditStep.finishedAt = Date.now();
        auditStep.success = false;
        auditStep.handled = false;
        auditStep.error = 'Message was deleted by user during processing.';
        appendAuditStep(pipelineData, auditStep);

        return {
          ruleMatched,
          ruleHandled,
          pending,
          terminatedByFailure: true,
        };
      }
      // ------------------------------------------------------------

      const input: CapabilityInput = {
        message: currentMessage, // Use the latest version of the message
        config: step.config,
        global: freshGlobal,
        actions,
        pipelineData,
        step,
      };

      const result: CapabilityOutput = await capability.execute(input);
      const isHandled = markOutputHandled(capability, result);

      // Log step result
      logExecution(
        pipelineData,
        `Step Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`
        + `${isHandled ? ' (HANDLED)' : ''}${result.error ? ` - Error: ${result.error}` : ''}`,
        stepId,
      );
      if (result.data && Object.keys(result.data).length > 0) {
        logExecution(pipelineData, `Step Output: ${JSON.stringify(result.data)}`, stepId);
      }

      auditStep.finishedAt = Date.now();
      auditStep.success = result.success;
      auditStep.handled = isHandled;
      auditStep.error = result.error;
      auditStep.outputKeys = result.data ? Object.keys(result.data).sort() : undefined;
      appendAuditStep(pipelineData, auditStep);

      // Merge output data
      if (result.data) {
        Object.assign(pipelineData, result.data);
      }

      if (result.success) {
        ruleMatched = true;
      }
      if (isHandled) {
        ruleHandled = true;
      }

      // Handle async deferred execution
      if (result.deferred) {
        logExecution(pipelineData, `Step requested deferred execution (delay: ${result.deferred.delay}ms)`);
        auditStep.pending = true;
        registerDeferredTask({
          delay: result.deferred.delay,
          checkFn: result.deferred.checkFn,
          pipeline,
          stepIndex: currentStepIndex,
          message,
          actions,
          pipelineData: { ...pipelineData }, // Ensure current step data is included
          ruleMatched,
          ruleHandled,
          executionContext,
        });
        ruleMatched = true;
        pending = true;
        break;
      }

      // Routing
      const {
        nextStepIndex,
        shouldContinue,
        actionHandled,
        actionPending,
      } = await handleRouting(
        result.success,
        step,
        pipeline,
        currentStepIndex,
        message,
        global,
        actions,
        pipelineData,
      );
      if (actionHandled) {
        ruleHandled = true;
      }
      if (actionPending) {
        pending = true;
        break;
      }

      if (nextStepIndex !== undefined && nextStepIndex !== currentStepIndex + 1) {
        const nextStep = pipeline[nextStepIndex];
        logExecution(
          pipelineData,
          `Routing: jumping to step ${nextStepIndex + 1} (${nextStep?.id || nextStep?.capabilityId})`,
        );
      }

      if (!shouldContinue) {
        logExecution(
          pipelineData,
          `Pipeline requested to STOP (Reason: ${result.success ? 'Success termination' : 'Failure termination'})`,
        );
        if (!result.success && step.onFailure?.stopPipeline) {
          terminatedByFailure = true;
        }
        break;
      }

      currentStepIndex = nextStepIndex!;
    } catch (error) {
      logExecution(pipelineData, `Step failed with error: ${error instanceof Error ? error.message : String(error)}`);
      auditStep.finishedAt = Date.now();
      auditStep.success = false;
      auditStep.handled = false;
      auditStep.error = error instanceof Error ? error.message : String(error);
      appendAuditStep(pipelineData, auditStep);
      if (step.onFailure?.stopPipeline !== false) {
        terminatedByFailure = true;
        break;
      }
      currentStepIndex++;
    }
  }

  return {
    ruleMatched,
    ruleHandled,
    pending,
    terminatedByFailure,
  };
}

/**
 * Execute a single rule
 */
export async function executeRule(
  rule: UserRule,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
  initialPipelineData?: Record<string, any>,
  executionContext?: RuleExecutionContext,
): Promise<CustomerServiceRuleExecutionResult> {
  const auditId = createAuditId(rule, message);
  const startedAt = Date.now();
  const eventType = executionContext?.eventType || 'any_message';
  const pipelineData = await buildInitialPipelineData(message, global, initialPipelineData, executionContext);
  pipelineData.ruleId = rule.id;
  pipelineData.ruleName = rule.name;

  logExecution(pipelineData, `Starting rule: ${rule.name} (${rule.id})`);

  const pipelineExecutionContext: PipelineExecutionContext = {
    auditId,
    rule,
    eventType,
    startedAt,
    onDeferredComplete: executionContext?.onDeferredComplete,
  };

  const {
    ruleMatched,
    ruleHandled,
    pending,
    terminatedByFailure,
  } = await executePipelineInternal(
    rule.pipeline,
    0,
    message,
    global,
    actions,
    pipelineData,
    pipelineExecutionContext,
  );

  const handled = ruleHandled && !terminatedByFailure;
  const skipPostProcessing = handled && Boolean(rule.skipPostProcessing);

  logExecution(
    pipelineData,
    `Rule finished. Matched: ${ruleMatched}, Handled: ${handled}, Pending: ${pending}, `
    + `TerminatedByFailure: ${terminatedByFailure}`,
  );

  return {
    matched: ruleMatched && !terminatedByFailure,
    handled,
    pending,
    terminatedByFailure,
    skipPostProcessing,
    pipelineData,
    auditLog: buildRuleAuditLog({
      auditId,
      rule,
      message,
      eventType,
      startedAt,
      pipelineData,
      matched: ruleMatched && !terminatedByFailure,
      handled,
      pending,
      terminatedByFailure,
      skipPostProcessing,
    }),
  };
}

/**
 * Execute an action capability
 */
export async function executeAction(
  actionExecution: ActionExecution,
  input: CapabilityInput,
): Promise<CapabilityOutput | undefined> {
  const actionId = typeof actionExecution === 'string'
    ? actionExecution
    : actionExecution.capabilityId;
  const actionConfig = typeof actionExecution === 'object'
    ? actionExecution.config || {}
    : {};

  const capability = capabilityRegistry.get(actionId);
  if (!capability || capability.type !== 'action') {
    logExecution(input.pipelineData, `Action error: Not found or not an action: ${actionId}`);
    return undefined;
  }

  const actionExecutionKey = createCapabilityExecutionKey(
    input.message,
    capability.id,
    'route_action',
    input.step?.id,
  );

  if (
    shouldConfirmExecution(getActionExecutionPolicy(actionExecution, input.global))
    && !isCapabilityExecutionApproved(input.pipelineData, actionExecutionKey)
  ) {
    const confirmation = buildCapabilityConfirmation({
      capability,
      executionSource: 'route_action',
      message: input.message,
      pipelineData: input.pipelineData,
      ruleId: typeof input.pipelineData.ruleId === 'string' ? input.pipelineData.ruleId : undefined,
      ruleName: typeof input.pipelineData.ruleName === 'string' ? input.pipelineData.ruleName : undefined,
      stepId: input.step?.id,
    });

    logExecution(input.pipelineData, `Waiting for human confirmation before action ${capability.name}`);
    registerCapabilityConfirmation(confirmation, {
      approve: async () => {
        const { getGlobal } = await import('../index');
        const freshGlobal = getGlobal();
        const resumePipelineData = { ...input.pipelineData };
        markCapabilityExecutionApproved(resumePipelineData, actionExecutionKey);
        logExecution(resumePipelineData, `Human approved action: ${capability.name}`);
        await executeAction(actionExecution, {
          ...input,
          global: freshGlobal,
          pipelineData: resumePipelineData,
        });
      },
      reject: () => {
        logExecution(input.pipelineData, `Human rejected action: ${capability.name}`);
      },
    });

    return {
      success: true,
      handled: false,
      data: {
        __capabilityConfirmationPending: true,
        confirmationId: confirmation.id,
      },
    };
  }

  try {
    // Simulate human behavior: additional delay before actions like replying
    const delayMs = getRandomStepDelayMs(true);
    logExecution(input.pipelineData, `Action human delay: ${delayMs}ms before ${capability.name}`);
    await sleep(delayMs);

    const actionInput: CapabilityInput = {
      ...input,
      config: actionConfig,
    };

    logExecution(input.pipelineData, `Executing action: ${capability.name}`);
    const result = await capability.execute(actionInput);
    const handled = markOutputHandled(capability, result);
    logExecution(
      input.pipelineData,
      `Action Result: ${result.success ? 'SUCCESS' : 'FAILURE'}`
      + `${handled ? ' (HANDLED)' : ''}${result.error ? ` - Error: ${result.error}` : ''}`,
    );

    return {
      ...result,
      handled,
    };
  } catch (error) {
    logExecution(
      input.pipelineData,
      `Action ${actionId} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      handled: false,
    };
  }
}

/**
 * Execute pipeline from a specific step index
 */
export async function executePipelineFromStep(
  pipeline: PipelineStep[],
  startIndex: number,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
  pipelineData: Record<string, any>,
): Promise<void> {
  await executePipelineInternal(pipeline, startIndex, message, global, actions, pipelineData);
}

/**
 * Process message with all enabled rules (main entry point)
 */
export async function processMessageWithRules(
  message: ApiMessage,
  eventType: CustomerServiceRuleEventType,
  global: GlobalState,
  actions: any,
  customRules?: UserRule[],
  initialPipelineData?: Record<string, any>,
): Promise<CustomerServiceRulesProcessResult> {
  const settings = selectCustomerServiceV2Settings(global);
  const rules = customRules || (settings?.rules?.filter((r) => r.enabled)) || [];

  if (rules.length === 0) {
    return {
      matched: false,
      handled: false,
      pending: false,
      skipPostProcessing: false,
      auditLogs: [],
      errors: [],
    };
  }

  let matched = false;
  let handled = false;
  let pending = false;
  let skipPostProcessing = false;
  const auditLogs: CustomerServiceRuleAuditLog[] = [];
  const errors: string[] = [];

  for (const rule of rules) {
    if (!checkTrigger(rule, message, eventType, global)) {
      continue;
    }

    try {
      const result = await executeRule(
        rule,
        message,
        global,
        actions,
        initialPipelineData,
        {
          eventType,
          rulePhase: rule.executionPhase,
        },
      );
      if (result.auditLog) {
        auditLogs.push(result.auditLog);
      }

      matched = matched || result.matched;
      handled = handled || result.handled;
      pending = pending || result.pending;

      if (result.skipPostProcessing) {
        skipPostProcessing = true;
        break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      errors.push(`${rule.id}: ${errorMessage}`);
      // eslint-disable-next-line no-console
      console.error(`[RuleEngine] Rule ${rule.id} failed:`, error);
    }
  }

  return {
    matched,
    handled,
    pending,
    skipPostProcessing,
    auditLogs,
    errors,
  };
}

/**
 * Check if rule trigger conditions match
 */
function checkTrigger(
  rule: UserRule,
  message: ApiMessage,
  eventType: CustomerServiceRuleEventType,
  global: GlobalState,
): boolean {
  if (rule.trigger.eventType !== 'any_message') {
    const settings = selectCustomerServiceV2Settings(global);
    const isFromBot = message.senderId && settings?.filteredUserIds?.includes(message.senderId);
    const actualEventType = isFromBot ? 'bot_reply' : 'customer_message';
    const effectiveEventType = eventType === 'any_message' ? actualEventType : eventType;

    if (rule.trigger.eventType !== effectiveEventType) {
      return false;
    }
  }

  if (rule.trigger.chatIds?.length && !rule.trigger.chatIds.includes(message.chatId)) {
    return false;
  }

  if (rule.trigger.senderIds?.length && (!message.senderId || !rule.trigger.senderIds.includes(message.senderId))) {
    return false;
  }

  return true;
}
