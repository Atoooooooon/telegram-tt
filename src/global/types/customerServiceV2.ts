import type { ApiMessage } from '../../api/types';

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
 * Maximum 5000 messages with FIFO cleanup
 */
export type CustomerServiceV2State = {
  /** Flat array of all CS messages (max 5000, FIFO) */
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
