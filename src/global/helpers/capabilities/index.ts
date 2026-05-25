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
  actionSendToCapability,
} from './actions';
// Import checkers
import {
  checkHasReplyCapability,
  checkMessageCapability,
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
  registerCapability(switchRouteCapability);

  // Extractors
  registerCapability(textProcessorCapability);
  registerCapability(ocrImageCapability);

  // Actions
  registerCapability(actionMarkReadCapability);
  registerCapability(actionAutoReplyCapability);
  registerCapability(actionAddQueueCapability);
  registerCapability(actionForwardCapability);
  registerCapability(actionSendToCapability);
}

// Export for reference
export {
  // Checkers
  checkMessageCapability,
  checkHasReplyCapability,
  waitForReplyCapability,
  switchRouteCapability,
  // Extractors
  textProcessorCapability,
  ocrImageCapability,
  // Actions
  actionMarkReadCapability,
  actionAutoReplyCapability,
  actionAddQueueCapability,
  actionForwardCapability,
  actionSendToCapability,
};
