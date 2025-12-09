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
} from '../types/customerServiceV2';

import { selectCustomerServiceV2Settings } from '../selectors/customerServiceV2';

// Capability registry
const capabilityRegistry = new Map<string, Capability>();

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
      };

      const result: CapabilityOutput = await capability.execute(input);

      // Merge output data into pipeline data
      if (result.data) {
        Object.assign(pipelineData, result.data);
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
 */
async function executeAction(
  actionId: string,
  input: CapabilityInput,
): Promise<void> {
  const capability = capabilityRegistry.get(actionId);
  if (!capability || capability.type !== 'action') {
    console.error(`[RuleEngine] Action not found: ${actionId}`);
    return;
  }

  try {
    await capability.execute(input);
  } catch (error) {
    console.error(`[RuleEngine] Action ${actionId} failed:`, error);
  }
}

/**
 * Process message with all enabled rules (main entry point)
 */
export async function processMessageWithRules(
  message: ApiMessage,
  eventType: 'customer_message' | 'bot_reply',
  global: GlobalState,
  actions: any,
): Promise<boolean> {
  const settings = selectCustomerServiceV2Settings(global);

  if (!settings?.ruleEngineConfig?.enabled) {
    return false;
  }

  const rules = settings.rules?.filter((r) => r.enabled) || [];
  if (rules.length === 0) {
    return false;
  }

  // Sort by priority (higher priority first)
  const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  let matched = false;

  for (const rule of sortedRules) {
    // Check trigger conditions
    if (!checkTrigger(rule, message, eventType)) {
      continue;
    }

    // Execute rule
    try {
      const handled = await executeRule(rule, message, global, actions);
      matched = matched || handled;
    } catch (error) {
      console.error(`[RuleEngine] Rule ${rule.id} failed:`, error);
    }
  }

  return matched;
}

/**
 * Check if rule trigger conditions match
 */
function checkTrigger(
  rule: UserRule,
  message: ApiMessage,
  eventType: string,
): boolean {
  // Check event type
  if (
    rule.trigger.eventType !== 'any_message'
    && rule.trigger.eventType !== eventType
  ) {
    return false;
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
