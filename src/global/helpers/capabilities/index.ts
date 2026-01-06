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
} from './checkers';

// Auto-register all capabilities
export function registerAllCapabilities(): void {
  // Checkers
  registerCapability(checkMessageCapability);
  registerCapability(checkHasReplyCapability);

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
  // Actions
  actionMarkReadCapability,
  actionAutoReplyCapability,
  actionAddQueueCapability,
  actionForwardCapability,
  actionSendToCapability,
};
