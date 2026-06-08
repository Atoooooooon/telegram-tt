/**
 * Capabilities registry
 * Export and auto-register all capabilities
 */

import { registerCapability } from '../ruleEngine';
// Import actions
import {
  actionAddQueueCapability,
  actionAutoReplyCapability,
  actionForwardCapability,
  actionMarkReadCapability,
  actionResolveCaseCapability,
  actionSendToCapability,
} from './actions';
// Import AI
import { aiGenerateReplyCapability } from './ai';
// Import checkers
import {
  checkHasReplyCapability,
  checkMessageCapability,
  suspendForHumanCapability,
  switchRouteCapability,
  waitForReplyCapability,
} from './checkers';
// Import extractors
import { textProcessorCapability } from './extractors';
import { ocrImageCapability } from './ocr';

// Auto-register all capabilities
export function registerAllCapabilities(): void {
  // Checkers
  registerCapability(checkMessageCapability);
  registerCapability(checkHasReplyCapability);
  registerCapability(waitForReplyCapability);
  registerCapability(suspendForHumanCapability);
  registerCapability(switchRouteCapability);

  // Extractors
  registerCapability(textProcessorCapability);
  registerCapability(ocrImageCapability);
  registerCapability(aiGenerateReplyCapability);

  // Actions
  registerCapability(actionMarkReadCapability);
  registerCapability(actionAutoReplyCapability);
  registerCapability(actionAddQueueCapability);
  registerCapability(actionResolveCaseCapability);
  registerCapability(actionForwardCapability);
  registerCapability(actionSendToCapability);
}

// Export for reference
export {
  // Checkers
  checkMessageCapability,
  checkHasReplyCapability,
  waitForReplyCapability,
  suspendForHumanCapability,
  switchRouteCapability,
  // Extractors
  textProcessorCapability,
  ocrImageCapability,
  aiGenerateReplyCapability,
  // Actions
  actionMarkReadCapability,
  actionAutoReplyCapability,
  actionAddQueueCapability,
  actionResolveCaseCapability,
  actionForwardCapability,
  actionSendToCapability,
};
