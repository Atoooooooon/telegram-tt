import type { ApiChat } from '../../api/types';
import type {
  CustomerServiceKnownChat,
  CustomerServiceOncallSettings,
  CustomerServiceQuickReply,
  CustomerServiceSettings,
  UserRule,
} from '../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';

const CUSTOMER_SERVICE_V2_SETTINGS_KEY = 'customerServiceV2Settings';
const DEFAULT_KNOWN_CHAT_TYPE: ApiChat['type'] = 'chatTypeSuperGroup';

type NormalizableSettings = {
  monitoredChatIds?: unknown;
  filteredUserIds?: unknown;
  regexFilters?: unknown;
  mode?: unknown;
  autoRead?: unknown;
  quickReplies?: unknown;
  quickReplyPanelGlobal?: unknown;
  rules?: unknown;
  oncall?: unknown;
  knownChats?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCustomerServiceQuickReplies(raw: unknown): CustomerServiceQuickReply[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<CustomerServiceQuickReply[]>((result, item) => {
    if (item === undefined) {
      return result;
    }

    if (typeof item === 'string') {
      const text = item.trim();
      if (text) {
        result.push({
          text,
          mode: 'send',
        });
      }
      return result;
    }

    if (!isRecord(item) || typeof item.text !== 'string') {
      return result;
    }

    const text = item.text.trim();
    if (!text) {
      return result;
    }

    let englishText: string | undefined;
    if (typeof item.englishText === 'string') {
      englishText = item.englishText.trim();
    } else if (typeof item.textEn === 'string') {
      englishText = item.textEn.trim();
    } else if (typeof item.enText === 'string') {
      englishText = item.enText.trim();
    }

    result.push({
      text,
      mode: item.mode === 'insert' ? 'insert' : 'send',
      englishText: englishText || undefined,
    });

    return result;
  }, []);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed || undefined;
}

function toNonNegativeNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const normalized = value.map((item) => String(item).trim()).filter(Boolean);
  return normalized.length ? normalized : [...fallback];
}

function normalizeKnownChat(raw: unknown): CustomerServiceKnownChat | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const id = toTrimmedString(raw.id);
  const title = toTrimmedString(raw.title);

  if (!id || !title) {
    return undefined;
  }

  const type = raw.type;

  return {
    id,
    title,
    type: typeof type === 'string' ? type as ApiChat['type'] : undefined,
    isForum: raw.isForum === true ? true : undefined,
  };
}

export function normalizeCustomerServiceKnownChats(raw: unknown): Record<string, CustomerServiceKnownChat> | undefined {
  if (!raw) {
    return undefined;
  }

  const items = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? Object.values(raw)
      : [];

  const knownChats = items.reduce<Record<string, CustomerServiceKnownChat>>((acc, item) => {
    const normalized = normalizeKnownChat(item);
    if (normalized) {
      acc[normalized.id] = normalized;
    }

    return acc;
  }, {});

  return Object.keys(knownChats).length ? knownChats : undefined;
}

function collectReferencedChatIds(
  monitoredChatIds?: string[],
  oncall?: CustomerServiceOncallSettings,
) {
  return Array.from(new Set([
    ...(monitoredChatIds || []),
    oncall?.newAlertChatId,
    oncall?.holdingAlertChatId,
    oncall?.highestAlertChatId,
    oncall?.resolvedAlertChatId,
  ].filter((chatId): chatId is string => Boolean(chatId))));
}

export function buildCustomerServiceKnownChats(params: {
  existing?: Record<string, CustomerServiceKnownChat>;
  chats?: Record<string, ApiChat>;
  monitoredChatIds?: string[];
  oncall?: CustomerServiceOncallSettings;
}): Record<string, CustomerServiceKnownChat> | undefined {
  const {
    existing,
    chats,
    monitoredChatIds,
    oncall,
  } = params;

  const referencedChatIds = collectReferencedChatIds(monitoredChatIds, oncall);
  const knownChats: Record<string, CustomerServiceKnownChat> = {};

  referencedChatIds.forEach((chatId) => {
    const chat = chats?.[chatId];
    if (chat?.title) {
      knownChats[chatId] = {
        id: chat.id,
        title: chat.title,
        type: chat.type,
        isForum: chat.isForum === true ? true : undefined,
      };
      return;
    }

    const snapshot = existing?.[chatId];
    if (snapshot?.title) {
      knownChats[chatId] = snapshot;
    }
  });

  return Object.keys(knownChats).length ? knownChats : undefined;
}

function isSelectableCustomerServiceChatType(type?: ApiChat['type']) {
  return type === 'chatTypeBasicGroup'
    || type === 'chatTypeSuperGroup'
    || type === 'chatTypeChannel';
}

function toKnownChatOption(chat: ApiChat | CustomerServiceKnownChat): ApiChat {
  return {
    id: chat.id,
    title: chat.title,
    type: chat.type || DEFAULT_KNOWN_CHAT_TYPE,
    isForum: chat.isForum,
  };
}

export function buildCustomerServiceChatOptions(params: {
  chats?: Record<string, ApiChat>;
  knownChats?: Record<string, CustomerServiceKnownChat>;
  referencedChatIds?: string[];
}): ApiChat[] {
  const {
    chats,
    knownChats,
    referencedChatIds,
  } = params;

  const chatOptionsById = new Map<string, ApiChat>();

  Object.values(chats || {}).forEach((chat) => {
    if (
      !chat
      || chat.isForbidden
      || chat.isRestricted
      || !isSelectableCustomerServiceChatType(chat.type)
    ) {
      return;
    }

    chatOptionsById.set(chat.id, chat);
  });

  Object.values(knownChats || {}).forEach((knownChat) => {
    if (
      chatOptionsById.has(knownChat.id)
      || (knownChat.type && !isSelectableCustomerServiceChatType(knownChat.type))
    ) {
      return;
    }

    chatOptionsById.set(knownChat.id, toKnownChatOption(knownChat));
  });

  (referencedChatIds || []).forEach((chatId) => {
    if (chatOptionsById.has(chatId)) {
      return;
    }

    const knownChat = knownChats?.[chatId];
    if (!knownChat?.title) {
      return;
    }

    chatOptionsById.set(chatId, toKnownChatOption(knownChat));
  });

  return Array.from(chatOptionsById.values())
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

export function normalizeCustomerServiceOncallSettings(raw: unknown): CustomerServiceOncallSettings {
  const defaults = CUSTOMER_SERVICE_CONFIG.ONCALL_DEFAULTS;
  const source = isRecord(raw) ? raw : {};

  return {
    enabled: Boolean(source.enabled),
    staffIds: normalizeStringArray(
      source.staffIds,
      defaults.staffIds,
    ),
    newAlertChatId: toTrimmedString(source.newAlertChatId),
    newAlertThreadId: toTrimmedString(source.newAlertThreadId),
    holdingAlertChatId: toTrimmedString(source.holdingAlertChatId),
    holdingAlertThreadId: toTrimmedString(source.holdingAlertThreadId),
    highestAlertChatId: toTrimmedString(source.highestAlertChatId),
    highestAlertThreadId: toTrimmedString(source.highestAlertThreadId),
    resolvedAlertChatId: toTrimmedString(source.resolvedAlertChatId),
    resolvedAlertThreadId: toTrimmedString(source.resolvedAlertThreadId),
    firstResponseTimeoutMs: toNonNegativeNumber(
      source.firstResponseTimeoutMs,
      defaults.firstResponseTimeoutMs,
    ),
    highestEscalationTimeoutMs: toNonNegativeNumber(
      source.highestEscalationTimeoutMs,
      defaults.highestEscalationTimeoutMs,
    ),
    holdingReplyGraceTimeoutMs: toNonNegativeNumber(
      source.holdingReplyGraceTimeoutMs,
      defaults.holdingReplyGraceTimeoutMs,
    ),
    reminderCooldownMs: toNonNegativeNumber(
      source.reminderCooldownMs,
      defaults.reminderCooldownMs,
    ),
    holdingReplyPatterns: normalizeStringArray(
      source.holdingReplyPatterns,
      defaults.holdingReplyPatterns,
    ),
    resolveReplyPatterns: normalizeStringArray(
      source.resolveReplyPatterns,
      defaults.resolveReplyPatterns,
    ),
  };
}

function normalizeSettings(raw: unknown): CustomerServiceSettings | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const {
    monitoredChatIds,
    filteredUserIds,
    regexFilters,
    mode,
    autoRead,
    quickReplies,
    quickReplyPanelGlobal,
    rules,
    oncall,
    knownChats,
  } = raw as NormalizableSettings;

  const normalized: CustomerServiceSettings = {
    monitoredChatIds: Array.isArray(monitoredChatIds)
      ? monitoredChatIds.map(String)
      : [],
    filteredUserIds: Array.isArray(filteredUserIds)
      ? filteredUserIds.map(String)
      : [],
    regexFilters: [],
    mode: mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(autoRead),
    quickReplies: normalizeCustomerServiceQuickReplies(quickReplies),
    quickReplyPanelGlobal: Boolean(quickReplyPanelGlobal),
    rules: Array.isArray(rules) ? rules as UserRule[] : undefined,
    oncall: normalizeCustomerServiceOncallSettings(oncall),
    knownChats: normalizeCustomerServiceKnownChats(knownChats),
  };

  if (Array.isArray(regexFilters)) {
    normalized.regexFilters = regexFilters.reduce<Array<{ source: string; flags: string }>>(
      (result, filter) => {
        if (!filter) {
          return result;
        }

        if (isRecord(filter) && typeof filter.source === 'string') {
          result.push({
            source: filter.source,
            flags: typeof filter.flags === 'string' ? filter.flags : '',
          });
          return result;
        }

        if (filter instanceof RegExp) {
          result.push({ source: filter.source, flags: filter.flags });
          return result;
        }

        if (typeof filter === 'string') {
          result.push({ source: filter, flags: '' });
        }

        return result;
      },
      [],
    );
  }

  return normalized;
}

function readFromStorage(key: string): CustomerServiceSettings | undefined {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return undefined;
    }

    return normalizeSettings(JSON.parse(stored));
  } catch (error) {
    return undefined;
  }
}

export function loadCustomerServiceV2SettingsFromStorage(): CustomerServiceSettings | undefined {
  return readFromStorage(CUSTOMER_SERVICE_V2_SETTINGS_KEY);
}

export function saveCustomerServiceV2SettingsToStorage(settings: CustomerServiceSettings) {
  try {
    localStorage.setItem(CUSTOMER_SERVICE_V2_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // Ignore storage errors
  }
}
