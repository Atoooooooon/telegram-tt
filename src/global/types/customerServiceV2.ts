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
  telegramAlertChatId?: string;
  telegramAlertThreadId?: string;
  firstResponseTimeoutMs?: number;
  highestEscalationTimeoutMs?: number;
  holdingReplyGraceTimeoutMs?: number;
  reminderCooldownMs?: number;
  holdingReplyPatterns?: string[];
  resolveReplyPatterns?: string[];
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
 * Customer Service V2 State
 * Ephemeral design - no persistence to IndexedDB
 * Bounded in-memory FIFO queue with mode-specific limits
 */
export type CustomerServiceV2State = {
  /** Flat array of all CS messages */
  messages: ApiMessage[];

  /** Multi-chat lookup map for efficient message display */
  messagesByChatId: Record<string, ApiMessage[]>;

  /** Shared settings with V1 */
  settings?: CustomerServiceSettings;

  /** Phase 2: Currently open context panel chat ID */
  currentContextChatId?: string;

  /** Phase 2: Highlighted message in context view */
  currentContextMessageId?: number;

  /** V1 compatibility: Paused chats for assist mode */
  pausedChats?: Record<string, PausedChat>;

  /** Last sync timestamp */
  lastSyncTimestamp: number;

  /** Cached message count for badge performance */
  messageCount: number;
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
export type CapabilityConfigSchema = {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'select' | 'textarea';
    label: string;
    default?: any;
    options?: string[];
    placeholder?: string;
    required?: boolean;
  };
};

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

/**
 * Pipeline step in a rule
 */
export type PipelineStep = {
  id: string;
  capabilityId: string;
  config: Record<string, any>;
  onSuccess?: {
    stopPipeline?: boolean;
    gotoStep?: string;
    executeAction?: ActionExecution;
  };
  onFailure?: {
    stopPipeline?: boolean;
    gotoStep?: string;
    executeAction?: ActionExecution;
  };
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
