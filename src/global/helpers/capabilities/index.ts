/**
 * Capabilities registry
 * Export and auto-register all capabilities
 */

import { registerCapability } from '../ruleEngine';

// Import checkers
import {
  checkTextMatchCapability,
  checkHasReplyCapability,
} from './checkers';

// Import actions
import {
  actionMarkReadCapability,
  actionAutoReplyCapability,
  actionAddQueueCapability,
} from './actions';

// Auto-register all capabilities
export function registerAllCapabilities(): void {
  // Checkers
  registerCapability(checkTextMatchCapability);
  registerCapability(checkHasReplyCapability);

  // Actions
  registerCapability(actionMarkReadCapability);
  registerCapability(actionAutoReplyCapability);
  registerCapability(actionAddQueueCapability);
}

// Export for reference
export {
  // Checkers
  checkTextMatchCapability,
  checkHasReplyCapability,
  // Actions
  actionMarkReadCapability,
  actionAutoReplyCapability,
  actionAddQueueCapability,
};
