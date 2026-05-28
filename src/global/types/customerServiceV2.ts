import type { ApiMessage } from '../../api/types';
import type { GlobalState } from './index';

export type CustomerServiceQuickReplyMode = 'send' | 'insert';

export type CustomerServiceQuickReply = {
  text: string;
  mode: CustomerServiceQuickReplyMode;
  englishText?: string;
};

export type CustomerServiceOncallSettings = {
  enabled?: boolean;
  staffIds?: string[];
  newAlertChatId?: string;
  newAlertThreadId?: string;
  holdingAlertChatId?: string;
  holdingAlertThreadId?: string;
  highestAlertChatId?: string;
  highestAlertThreadId?: string;
  processingAlertChatId?: string;
  processingAlertThreadId?: string;
  resolvedAlertChatId?: string;
  resolvedAlertThreadId?: string;
  firstResponseTimeoutMs?: number;
  highestEscalationTimeoutMs?: number;
  holdingReplyGraceTimeoutMs?: number;
  reminderCooldownMs?: number;
  holdingReplyPatterns?: string[];
  resolveReplyPatterns?: string[];
  customerResolvePatterns?: string[];
};

/**
 * Virtual ChatId constant for Customer Service V2
 * This represents the Customer Service view as a virtual chat in the message list
 */
export const CUSTOMER_SERVICE_VIRTUAL_CHAT_ID = '___cs___';

/**
 * Customer Service V2 Settings
 * Shared with V1 for compatibility
 */
export type CustomerServiceSettings = {
  /** List of monitored chat IDs */
  monitoredChatIds: string[];
  /** List of filtered user IDs (blocked users) */
  filteredUserIds: string[];
  /** Regex filter patterns */
  regexFilters: Array<{
    source: string;
    flags: string;
  }>;
  /** Auto-read messages when added to CS */
  autoRead?: boolean;
  /** Operating mode */
  mode: 'oncall' | 'assist';
  /** Predefined quick reply templates */
  quickReplies?: CustomerServiceQuickReply[];
  /** Allow quick reply panel outside customer service context */
  quickReplyPanelGlobal?: boolean;

  /** Rule engine: User-configured rules */
  rules?: UserRule[];

  /** Personal oncall guarantee settings */
  oncall?: CustomerServiceOncallSettings;
};

/**
 * Paused chat information for assist mode
 */
export type PausedChat = {
  /** Timestamp when chat was paused */
  pausedAt: number;
  /** Last message ID that triggered pause */
  lastMessageId: number;
};

/**
 * Customer Service V2 State — shared across all tabs, lives in global (not byTabId)
 * Ephemeral design - no persistence to IndexedDB
 * Bounded in-memory FIFO queue with mode-specific limits
 */
export type CustomerServiceV2State = {
  messages: ApiMessage[];
  messagesByChatId: Record<string, ApiMessage[]>;
  settings?: CustomerServiceSettings;
  pausedChats?: Record<string, PausedChat>;
  auditLogs?: CustomerServiceRuleAuditLog[];
  lastSyncTimestamp: number;
  messageCount: number;
};

/**
 * Per-tab UI context for Customer Service V2
 * Tracks which message is currently focused in each browser tab
 */
export type CustomerServiceV2Context = {
  currentContextChatId?: string;
  currentContextMessageId?: number;
};

/**
 * Customer Service message with additional metadata
 */
export type CustomerServiceMessage = ApiMessage & {
  /** Timestamp when added to CS */
  csAddedAt: number;
  /** Original chat ID (for multi-chat reference) */
  sourceChatId: string;
};

/**
 * Customer Service message group
 * Groups consecutive messages from the same sender in the same chat
 */
export type CustomerServiceMessageGroup = {
  /** Unique group identifier */
  id: string;
  /** Source chat ID */
  chatId: string;
  /** Sender user ID */
  senderId: string;
  /** Messages in this group */
  messages: ApiMessage[];
  /** First message timestamp */
  firstMessageDate: number;
  /** Last message timestamp */
  lastMessageDate: number;
  /** Total message count in group */
  messageCount: number;
};

// ============ Rule Engine Types ============

/**
 * Capability type classification
 */
export type CapabilityType = 'checker' | 'extractor' | 'action';

/**
 * Configuration schema for capability parameters
 */
export type CapabilityConfigSchema = Record<string, {
  type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
  label: string;
  default?: any;
  options?: string[];
  placeholder?: string;
  required?: boolean;
}>;

/**
 * Capability execution input
 */
export type CapabilityInput = {
  message: ApiMessage;
  config: Record<string, any>;
  global: GlobalState;
  actions: any;
  pipelineData: Record<string, any>;
  step?: PipelineStep; // Optional: for async capabilities that need access to routing config
};

/**
 * Capability execution output
 */
export type CapabilityOutput = {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
  /**
   * Marks the message as fully handled by this capability.
   * Action capabilities default to handled on success; checkers/extractors do not.
   */
  handled?: boolean;
  /**
   * Deferred execution for async capabilities
   * When set, the sync engine will stop and register this task to async executor
   */
  deferred?: {
    delay: number; // Delay in milliseconds
    checkFn: () => Promise<boolean | { success: boolean; data?: Record<string, any> }>; // Returns result or result with data
  };
};

/**
 * Capability definition
 */
export type Capability = {
  id: string;
  name: string;
  type: CapabilityType;
  description?: string;
  configSchema: CapabilityConfigSchema;
  execute: (input: CapabilityInput) => Promise<CapabilityOutput>;
};

/**
 * Action execution configuration
 * Can be a simple capability ID string or an object with config
 */
export type ActionExecution = string | {
  capabilityId: string;
  config?: Record<string, any>;
};

export type PipelineSetConfig = Record<string, unknown>;

export type PipelineRoute = {
  stopPipeline?: boolean;
  gotoStep?: string;
  executeAction?: ActionExecution;
  set?: PipelineSetConfig;
};

/**
 * Pipeline step in a rule
 */
export type PipelineStep = {
  id: string;
  capabilityId: string;
  config: Record<string, any>;
  set?: PipelineSetConfig;
  onSuccess?: PipelineRoute;
  onFailure?: PipelineRoute;
};

/**
 * User-configured rule
 * Priority is determined by array order - first rule has highest priority
 */
export type UserRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** Execution phase: pre-filter runs before filtering, post-filter runs after (default) */
  executionPhase?: 'pre-filter' | 'post-filter';
  /** Skip all post-processing (filtering and post-filter rules) when true */
  skipPostProcessing?: boolean;
  trigger: {
    eventType: 'customer_message' | 'bot_reply' | 'any_message';
    chatIds?: string[];
    senderIds?: string[];
  };
  pipeline: PipelineStep[];
};

export type CustomerServiceRuleEventType = 'customer_message' | 'bot_reply' | 'any_message';

export type CustomerServicePipelineVariableDefinition = {
  key: string;
  label: string;
  description: string;
  source: 'message' | 'chat' | 'sender' | 'runtime' | 'capability';
  example?: string;
};

export const CUSTOMER_SERVICE_PIPELINE_VARIABLES = [
  {
    key: 'chatId',
    label: 'Source chat ID',
    description: 'Telegram chat ID where the original message arrived.',
    source: 'chat',
    example: '-1001234567890',
  },
  {
    key: 'chatTitle',
    label: 'Source chat title',
    description: 'Readable title for the source chat.',
    source: 'chat',
    example: 'Customer Support Group',
  },
  {
    key: 'chatName',
    label: 'Source chat name',
    description: 'Alias of chatTitle for compatibility with older rules.',
    source: 'chat',
    example: 'Customer Support Group',
  },
  {
    key: 'messageId',
    label: 'Message ID',
    description: 'Telegram message ID of the original message.',
    source: 'message',
    example: '12345',
  },
  {
    key: 'senderId',
    label: 'Sender ID',
    description: 'Telegram user ID of the message sender when available.',
    source: 'sender',
    example: '777000',
  },
  {
    key: 'sender',
    label: 'Sender name',
    description: 'Readable sender display name.',
    source: 'sender',
    example: 'Alice',
  },
  {
    key: 'senderName',
    label: 'Sender name',
    description: 'Alias of sender for compatibility with older rules.',
    source: 'sender',
    example: 'Alice',
  },
  {
    key: 'isSenderBot',
    label: 'Sender is bot',
    description: 'String value "true" or "false" for template and checker use.',
    source: 'sender',
    example: 'false',
  },
  {
    key: 'text',
    label: 'Message text',
    description: 'Best available text for the message, falling back to preview text for non-text messages.',
    source: 'message',
    example: 'Hello, I need help',
  },
  {
    key: 'previewText',
    label: 'Preview text',
    description: 'Telegram message summary text.',
    source: 'message',
    example: 'Photo',
  },
  {
    key: 'date',
    label: 'Message timestamp',
    description: 'Original Telegram message timestamp in seconds when available.',
    source: 'message',
    example: '1712678400',
  },
  {
    key: 'createdAt',
    label: 'Message timestamp ms',
    description: 'Message timestamp in milliseconds, or current time when message date is unavailable.',
    source: 'message',
    example: '1712678400000',
  },
  {
    key: 'eventType',
    label: 'Rule event type',
    description: 'Current rule event type: customer_message, bot_reply, or any_message.',
    source: 'runtime',
    example: 'customer_message',
  },
  {
    key: 'rulePhase',
    label: 'Rule phase',
    description: 'Processing phase that invoked the rule.',
    source: 'runtime',
    example: 'post-filter',
  },
] satisfies CustomerServicePipelineVariableDefinition[];

export type CustomerServicePipelineVariableKey =
  typeof CUSTOMER_SERVICE_PIPELINE_VARIABLES[number]['key'];

export type CustomerServiceRuleAuditStep = {
  stepId: string;
  capabilityId: string;
  capabilityName?: string;
  startedAt: number;
  finishedAt?: number;
  success?: boolean;
  handled?: boolean;
  pending?: boolean;
  error?: string;
  outputKeys?: string[];
};

export type CustomerServiceRuleAuditLog = {
  id: string;
  ruleId: string;
  ruleName: string;
  chatId: string;
  messageId: number;
  eventType: CustomerServiceRuleEventType;
  rulePhase?: UserRule['executionPhase'];
  startedAt: number;
  finishedAt: number;
  matched: boolean;
  handled: boolean;
  pending: boolean;
  terminatedByFailure: boolean;
  skipPostProcessing: boolean;
  error?: string;
  executionLog: string[];
  steps: CustomerServiceRuleAuditStep[];
  pipelineDataKeys: string[];
};

export type CustomerServiceRuleExecutionResult = {
  matched: boolean;
  handled: boolean;
  pending: boolean;
  terminatedByFailure: boolean;
  skipPostProcessing: boolean;
  auditLog?: CustomerServiceRuleAuditLog;
};

export type CustomerServiceRulesProcessResult = {
  matched: boolean;
  handled: boolean;
  pending: boolean;
  skipPostProcessing: boolean;
  auditLogs: CustomerServiceRuleAuditLog[];
  errors: string[];
};
