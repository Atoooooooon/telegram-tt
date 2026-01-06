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

const ACTION_STEP_DELAY_MIN_MS = 1000;
const ACTION_STEP_DELAY_MAX_MS = 10000;

function getRandomActionStepDelayMs(): number {
  return randomDelayMs(ACTION_STEP_DELAY_MIN_MS, ACTION_STEP_DELAY_MAX_MS);
}

// Capability registry
const capabilityRegistry = new Map<string, Capability>();

/**
 * Deferred task for async capabilities
 */
type DeferredTask = {
  delay: number;
  checkFn: () => Promise<boolean>;
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
      // eslint-disable-next-line no-console
      console.log(`[RuleEngine:Async] Executing deferred task for message ${task.message.id}`);

      // Execute the check function to get success/failure
      const success = await task.checkFn();

      // eslint-disable-next-line no-console
      console.log(`[RuleEngine:Async] Check result: ${success ? 'success' : 'failure'}`);

      // Get the current step and its routing config
      const step = task.pipeline[task.stepIndex];

      // Get fresh global state
      const { getGlobal } = await import('../index');
      const freshGlobal = getGlobal();

      // Create input for routing
      const input: CapabilityInput = {
        message: task.message,
        config: step.config,
        global: freshGlobal,
        actions: task.actions,
        pipelineData: task.pipelineData,
        step,
      };

      // Handle routing based on success/failure (same logic as sync engine)
      let nextStepIndex = task.stepIndex + 1;
      let shouldContinue = true;

      if (success) {
        if (step.onSuccess?.executeAction) {
          await executeAction(step.onSuccess.executeAction, input);
        }

        if (step.onSuccess?.gotoStep) {
          const targetIndex = task.pipeline.findIndex(
            (s) => s.id === step.onSuccess!.gotoStep,
          );
          if (targetIndex !== -1) {
            nextStepIndex = targetIndex;
          }
        }

        if (step.onSuccess?.continueNext === false) {
          shouldContinue = false;
        }
      } else {
        if (step.onFailure?.executeAction) {
          await executeAction(step.onFailure.executeAction, input);
        }

        if (step.onFailure?.gotoStep) {
          const targetIndex = task.pipeline.findIndex(
            (s) => s.id === step.onFailure!.gotoStep,
          );
          if (targetIndex !== -1) {
            nextStepIndex = targetIndex;
          }
        }

        if (step.onFailure?.stopPipeline) {
          shouldContinue = false;
        }
      }

      // Continue pipeline execution if needed
      if (shouldContinue && nextStepIndex < task.pipeline.length) {
        // eslint-disable-next-line no-console
        console.log(`[RuleEngine:Async] Continuing pipeline from step ${nextStepIndex + 1}`);

        await executePipelineFromStep(
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
 * Execute a single rule
 */
export async function executeRule(
  rule: UserRule,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
): Promise<boolean> {
  const pipelineData: Record<string, any> = {
    message,
    chatId: message.chatId,
    senderId: message.senderId || '',
    text: '', // Will be populated by capabilities
  };

  // eslint-disable-next-line no-console
  console.log(`[RuleEngine] Executing rule: ${rule.name} (${rule.id})`);

  let currentStepIndex = 0;
  let ruleMatched = false;
  let terminatedByFailure = false;

  while (currentStepIndex < rule.pipeline.length) {
    const step = rule.pipeline[currentStepIndex];
    const capability = capabilityRegistry.get(step.capabilityId);

    if (!capability) {
      console.error(`[RuleEngine] Capability not found: ${step.capabilityId}`);
      terminatedByFailure = true;
      break;
    }

    // eslint-disable-next-line no-console
    console.log(`  Step ${currentStepIndex + 1}: ${capability.name}`);

    try {
      const input: CapabilityInput = {
        message,
        config: step.config,
        global,
        actions,
        pipelineData,
        step, // Pass step for async capabilities
      };

      const result: CapabilityOutput = await capability.execute(input);

      // Merge output data into pipeline data
      if (result.data) {
        Object.assign(pipelineData, result.data);
      }

      // Handle deferred execution (async capabilities)
      if (result.deferred) {
        // eslint-disable-next-line no-console
        console.log(`[RuleEngine] Capability returned deferred task, scheduling async execution in ${result.deferred.delay}ms`);

        // Register deferred task
        registerDeferredTask({
          delay: result.deferred.delay,
          checkFn: result.deferred.checkFn,
          pipeline: rule.pipeline,
          stepIndex: currentStepIndex,
          message,
          actions,
          pipelineData: { ...pipelineData }, // Clone to preserve state
        });

        // Sync engine stops here, deferred task will continue later
        ruleMatched = true;
        break;
      }

      // Add delay after action capabilities to prevent rate limiting
      if (capability.type === 'action') {
        const stepDelayMs = getRandomActionStepDelayMs();
        // eslint-disable-next-line no-console
        console.log(`[RuleEngine] Waiting ${stepDelayMs}ms after action to prevent rate limiting`);
        await sleep(stepDelayMs);
      }

      // Handle routing
      if (result.success) {
        ruleMatched = true;
        if (step.onSuccess?.executeAction) {
          await executeAction(step.onSuccess.executeAction, input);
        }

        if (step.onSuccess?.gotoStep) {
          const targetIndex = rule.pipeline.findIndex(
            (s) => s.id === step.onSuccess!.gotoStep,
          );
          if (targetIndex !== -1) {
            currentStepIndex = targetIndex;
            continue;
          }
        }

        if (step.onSuccess?.continueNext === false) {
          break;
        }
      } else {
        if (step.onFailure?.executeAction) {
          await executeAction(step.onFailure.executeAction, input);
        }

        if (step.onFailure?.gotoStep) {
          const targetIndex = rule.pipeline.findIndex(
            (s) => s.id === step.onFailure!.gotoStep,
          );
          if (targetIndex !== -1) {
            currentStepIndex = targetIndex;
            continue;
          }
        }

        if (step.onFailure?.stopPipeline) {
          terminatedByFailure = true;
          break;
        }
      }

      currentStepIndex++;
    } catch (error) {
      console.error(`[RuleEngine] Step ${currentStepIndex + 1} failed:`, error);
      if (step.onFailure?.stopPipeline !== false) {
        terminatedByFailure = true;
        break;
      }
      currentStepIndex++;
    }
  }

  return ruleMatched && !terminatedByFailure;
}

/**
 * Execute an action capability
 * Supports both simple string action ID and object with config
 * Exported for use by async capabilities
 */
export async function executeAction(
  actionExecution: string | { capabilityId: string; config?: Record<string, any> },
  input: CapabilityInput,
): Promise<void> {
  // Parse action execution config
  const actionId = typeof actionExecution === 'string'
    ? actionExecution
    : actionExecution.capabilityId;
  const actionConfig = typeof actionExecution === 'object'
    ? actionExecution.config || {}
    : {};

  const capability = capabilityRegistry.get(actionId);
  if (!capability || capability.type !== 'action') {
    console.error(`[RuleEngine] Action not found: ${actionId}`);
    return;
  }

  try {
    // Merge action config with input
    const actionInput: CapabilityInput = {
      ...input,
      config: actionConfig,
    };
    await capability.execute(actionInput);

    // Add delay after action to prevent rate limiting
    const stepDelayMs = getRandomActionStepDelayMs();
    // eslint-disable-next-line no-console
    console.log(`[RuleEngine] Waiting ${stepDelayMs}ms after executeAction to prevent rate limiting`);
    await sleep(stepDelayMs);
  } catch (error) {
    console.error(`[RuleEngine] Action ${actionId} failed:`, error);
  }
}

/**
 * Execute pipeline from a specific step index
 * Used by async capabilities to continue pipeline execution after delay
 * Exported for use by async capabilities
 */
export async function executePipelineFromStep(
  pipeline: PipelineStep[],
  startIndex: number,
  message: ApiMessage,
  global: GlobalState,
  actions: any,
  pipelineData: Record<string, any>,
): Promise<void> {
  let currentStepIndex = startIndex;

  // eslint-disable-next-line no-console
  console.log(`[RuleEngine] Continuing pipeline from step ${startIndex + 1}`);

  while (currentStepIndex < pipeline.length) {
    const step = pipeline[currentStepIndex];
    const capability = capabilityRegistry.get(step.capabilityId);

    if (!capability) {
      console.error(`[RuleEngine] Capability not found: ${step.capabilityId}`);
      break;
    }

    // eslint-disable-next-line no-console
    console.log(`  Step ${currentStepIndex + 1}: ${capability.name}`);

    try {
      const input: CapabilityInput = {
        message,
        config: step.config,
        global,
        actions,
        pipelineData,
        step,
      };

      const result: CapabilityOutput = await capability.execute(input);

      // Merge output data into pipeline data
      if (result.data) {
        Object.assign(pipelineData, result.data);
      }

      // Add delay after action capabilities to prevent rate limiting
      if (capability.type === 'action') {
        const stepDelayMs = getRandomActionStepDelayMs();
        // eslint-disable-next-line no-console
        console.log(`[RuleEngine] Waiting ${stepDelayMs}ms after action to prevent rate limiting`);
        await sleep(stepDelayMs);
      }

      // Handle routing
      if (result.success) {
        if (step.onSuccess?.executeAction) {
          await executeAction(step.onSuccess.executeAction, input);
        }

        if (step.onSuccess?.gotoStep) {
          const targetIndex = pipeline.findIndex(
            (s) => s.id === step.onSuccess!.gotoStep,
          );
          if (targetIndex !== -1) {
            currentStepIndex = targetIndex;
            continue;
          }
        }

        if (step.onSuccess?.continueNext === false) {
          break;
        }
      } else {
        if (step.onFailure?.executeAction) {
          await executeAction(step.onFailure.executeAction, input);
        }

        if (step.onFailure?.gotoStep) {
          const targetIndex = pipeline.findIndex(
            (s) => s.id === step.onFailure!.gotoStep,
          );
          if (targetIndex !== -1) {
            currentStepIndex = targetIndex;
            continue;
          }
        }

        if (step.onFailure?.stopPipeline) {
          break;
        }
      }

      currentStepIndex++;
    } catch (error) {
      console.error(`[RuleEngine] Step ${currentStepIndex + 1} failed:`, error);
      if (step.onFailure?.stopPipeline !== false) {
        break;
      }
      currentStepIndex++;
    }
  }
}

/**
 * Process message with all enabled rules (main entry point)
 * @param customRules - Optional custom rule list (for phase-specific execution)
 * @returns { matched, skipPostProcessing }
 */
export async function processMessageWithRules(
  message: ApiMessage,
  eventType: 'customer_message' | 'bot_reply' | 'any_message',
  global: GlobalState,
  actions: any,
  customRules?: UserRule[],
): Promise<{ matched: boolean; skipPostProcessing: boolean }> {
  const settings = selectCustomerServiceV2Settings(global);

  // Use custom rules or filter enabled rules from settings
  const rules = customRules || (settings?.rules?.filter((r) => r.enabled)) || [];
  if (rules.length === 0) {
    return { matched: false, skipPostProcessing: false };
  }

  // Rules are already sorted by priority (array order = priority)

  let matched = false;
  let skipPostProcessing = false;

  for (const rule of rules) {
    // Check trigger conditions
    if (!checkTrigger(rule, message, eventType, global)) {
      continue;
    }

    // Execute rule
    try {
      const handled = await executeRule(rule, message, global, actions);
      matched = matched || handled;

      // Check if rule requests to skip post-processing
      if (handled && rule.skipPostProcessing) {
        skipPostProcessing = true;
        // eslint-disable-next-line no-console
        console.log(`[RuleEngine] Rule ${rule.id} requests skipPostProcessing, breaking execution`);
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
 * Independently determines message type without relying on filtering
 */
function checkTrigger(
  rule: UserRule,
  message: ApiMessage,
  eventType: 'customer_message' | 'bot_reply' | 'any_message',
  global: GlobalState,
): boolean {
  // Check event type
  if (rule.trigger.eventType !== 'any_message') {
    // Independently determine if message is from bot
    const settings = selectCustomerServiceV2Settings(global);
    const isFromBot = message.senderId && settings?.filteredUserIds?.includes(message.senderId);
    const actualEventType = isFromBot ? 'bot_reply' : 'customer_message';

    // Use provided eventType if available, otherwise determine independently
    const effectiveEventType = eventType === 'any_message' ? actualEventType : eventType;

    if (rule.trigger.eventType !== effectiveEventType) {
      return false;
    }
  }

  // Check chat IDs
  if (rule.trigger.chatIds && rule.trigger.chatIds.length > 0) {
    if (!rule.trigger.chatIds.includes(message.chatId)) {
      return false;
    }
  }

  // Check sender IDs
  if (rule.trigger.senderIds && rule.trigger.senderIds.length > 0) {
    if (!message.senderId || !rule.trigger.senderIds.includes(message.senderId)) {
      return false;
    }
  }

  return true;
}
