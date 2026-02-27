/**
 * Customer Service Rule Engine
 * Capability-based pipeline execution system
 */

import type { ApiMessage } from '../../api/types';
import type { GlobalState } from '../types';
import type {
  Capability,
  CapabilityInput,
  CapabilityOutput,
  UserRule,
  PipelineStep,
  ActionExecution,
} from '../types/customerServiceV2';

import { selectCustomerServiceV2Settings } from '../selectors/customerServiceV2';

import { randomDelayMs, sleep } from '../../util/delays';

// Delay configuration for simulating human behavior
const STEP_DELAY_MIN_MS = 1000;
const STEP_DELAY_MAX_MS = 10000;
const ACTION_DELAY_MIN_MS = 2000;
const ACTION_DELAY_MAX_MS = 15000;

function getRandomStepDelayMs(isAction = false): number {
  return isAction
    ? randomDelayMs(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS)
    : randomDelayMs(STEP_DELAY_MIN_MS, STEP_DELAY_MAX_MS);
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
};

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

      logExecution(task.pipelineData, `[Async] Check result: ${success ? 'success' : 'failure'}`);

      // Get fresh global state
      const { getGlobal } = await import('../index');
      const freshGlobal = getGlobal();

      // Update pipeline data with result data if available
      if (resultData) {
        Object.assign(task.pipelineData, resultData);
      }

      const currentStep = task.pipeline[task.stepIndex];
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

      // Continue pipeline execution if needed
      if (shouldContinue && nextStepIndex !== undefined && nextStepIndex < task.pipeline.length) {
        logExecution(task.pipelineData, `[Async] Continuing pipeline from step ${nextStepIndex + 1}`);

        await executePipelineInternal(
          task.pipeline,
          nextStepIndex,
          task.message,
          freshGlobal,
          task.actions,
          task.pipelineData,
        );
      }
    } catch (error) {
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
): Promise<{ nextStepIndex?: number; shouldContinue: boolean }> {
  const routing = success ? step.onSuccess : step.onFailure;
  let nextStepIndex = currentIndex + 1;
  let shouldContinue = true;

  const input: CapabilityInput = {
    message,
    config: step.config,
    global,
    actions,
    pipelineData,
    step,
  };

  if (routing?.executeAction) {
    await executeAction(routing.executeAction, input);
  }

  if (routing?.gotoStep) {
    const targetIndex = pipeline.findIndex((s) => s.id === routing.gotoStep);
    if (targetIndex !== -1) {
      nextStepIndex = targetIndex;
    } else {
      logExecution(pipelineData, `Routing error: Step "${routing.gotoStep}" not found`);
    }
  }

  // Consistent stop logic
  if (routing?.stopPipeline) {
    shouldContinue = false;
  }

  return { nextStepIndex, shouldContinue };
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
): Promise<{ ruleMatched: boolean; terminatedByFailure: boolean }> {
  let currentStepIndex = startIndex;
  let ruleMatched = false;
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

    try {
      // Unified human-like delay before step
      const delayMs = getRandomStepDelayMs(capability.type === 'action');
      logExecution(pipelineData, `Simulating human delay: ${delayMs}ms`, stepId);
      await sleep(delayMs);

      // --- Sanity Check: Ensure message still exists in GlobalState ---
      const { getGlobal } = await import('../index');
      const { selectChatMessage } = await import('../selectors');
      const freshGlobal = getGlobal();
      const currentMessage = selectChatMessage(freshGlobal, message.chatId, message.id);

      if (!currentMessage) {
        logExecution(pipelineData, 'Abort: Message was deleted by user during processing.', stepId);
        return { ruleMatched, terminatedByFailure: true };
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

      // Log step result
      logExecution(pipelineData, `Step Result: ${result.success ? 'SUCCESS' : 'FAILURE'}${result.error ? ` - Error: ${result.error}` : ''}`, stepId);
      if (result.data && Object.keys(result.data).length > 0) {
        logExecution(pipelineData, `Step Output: ${JSON.stringify(result.data)}`, stepId);
      }

      // Merge output data
      if (result.data) {
        Object.assign(pipelineData, result.data);
      }

      // Handle async deferred execution
      if (result.deferred) {
        logExecution(pipelineData, `Step requested deferred execution (delay: ${result.deferred.delay}ms)`);
        registerDeferredTask({
          delay: result.deferred.delay,
          checkFn: result.deferred.checkFn,
          pipeline,
          stepIndex: currentStepIndex,
          message,
          actions,
          pipelineData: { ...pipelineData }, // Ensure current step data is included
        });
        ruleMatched = true;
        break;
      }

      if (result.success) {
        ruleMatched = true;
      }

      // Routing
      const { nextStepIndex, shouldContinue } = await handleRouting(
        result.success,
        step,
        pipeline,
        currentStepIndex,
        message,
        global,
        actions,
        pipelineData,
      );

      if (nextStepIndex !== undefined && nextStepIndex !== currentStepIndex + 1) {
        const nextStep = pipeline[nextStepIndex];
        logExecution(pipelineData, `Routing: jumping to step ${nextStepIndex + 1} (${nextStep?.id || nextStep?.capabilityId})`);
      }

      if (!shouldContinue) {
        logExecution(pipelineData, `Pipeline requested to STOP (Reason: ${result.success ? 'Success termination' : 'Failure termination'})`);
        if (!result.success && step.onFailure?.stopPipeline) {
          terminatedByFailure = true;
        }
        break;
      }

      currentStepIndex = nextStepIndex!;
    } catch (error) {
      logExecution(pipelineData, `Step failed with error: ${error instanceof Error ? error.message : String(error)}`);
      if (step.onFailure?.stopPipeline !== false) {
        terminatedByFailure = true;
        break;
      }
      currentStepIndex++;
    }
  }

  return { ruleMatched, terminatedByFailure };
}

/**
 * Execute a single rule
 */
export async function executeRule(
  rule: UserRule,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
): Promise<boolean> {
  const { selectChat } = await import('../selectors');
  const chat = selectChat(global, message.chatId);

  const pipelineData: Record<string, any> = {
    message,
    chatId: message.chatId,
    chatTitle: chat?.title || '', // Pre-load chat title
    senderId: message.senderId || '',
    text: '',
    executionLog: [],
  };

  logExecution(pipelineData, `Starting rule: ${rule.name} (${rule.id})`);

  const { ruleMatched, terminatedByFailure } = await executePipelineInternal(
    rule.pipeline,
    0,
    message,
    global,
    actions,
    pipelineData,
  );

  logExecution(pipelineData, `Rule finished. Matched: ${ruleMatched}, TerminatedByFailure: ${terminatedByFailure}`);
  return ruleMatched && !terminatedByFailure;
}

/**
 * Execute an action capability
 */
export async function executeAction(
  actionExecution: ActionExecution,
  input: CapabilityInput,
): Promise<void> {
  const actionId = typeof actionExecution === 'string'
    ? actionExecution
    : actionExecution.capabilityId;
  const actionConfig = typeof actionExecution === 'object'
    ? actionExecution.config || {}
    : {};

  const capability = capabilityRegistry.get(actionId);
  if (!capability || capability.type !== 'action') {
    logExecution(input.pipelineData, `Action error: Not found or not an action: ${actionId}`);
    return;
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
    await capability.execute(actionInput);
  } catch (error) {
    logExecution(input.pipelineData, `Action ${actionId} failed: ${error instanceof Error ? error.message : String(error)}`);
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
  eventType: 'customer_message' | 'bot_reply' | 'any_message',
  global: GlobalState,
  actions: any,
  customRules?: UserRule[],
): Promise<{ matched: boolean; skipPostProcessing: boolean }> {
  const settings = selectCustomerServiceV2Settings(global);
  const rules = customRules || (settings?.rules?.filter((r) => r.enabled)) || [];

  if (rules.length === 0) {
    return { matched: false, skipPostProcessing: false };
  }

  let matched = false;
  let skipPostProcessing = false;

  for (const rule of rules) {
    if (!checkTrigger(rule, message, eventType, global)) {
      continue;
    }

    try {
      const handled = await executeRule(rule, message, global, actions);
      matched = matched || handled;

      if (handled && rule.skipPostProcessing) {
        skipPostProcessing = true;
        break;
      }
    } catch (error) {
      console.error(`[RuleEngine] Rule ${rule.id} failed:`, error);
    }
  }

  return { matched, skipPostProcessing };
}

/**
 * Check if rule trigger conditions match
 */
function checkTrigger(
  rule: UserRule,
  message: ApiMessage,
  eventType: 'customer_message' | 'bot_reply' | 'any_message',
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