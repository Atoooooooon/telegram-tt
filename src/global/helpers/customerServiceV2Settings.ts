import type {
  CustomerServiceOncallSettings,
  CustomerServiceQuickReply,
  CustomerServiceSettings,
  UserRule,
} from '../types/customerServiceV2';

import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';

const CUSTOMER_SERVICE_V2_SETTINGS_KEY = 'customerServiceV2Settings';

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCustomerServiceQuickReplies(raw: unknown): CustomerServiceQuickReply[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<CustomerServiceQuickReply[]>((result, item) => {
    if (item === undefined || (!item && typeof item === 'object')) {
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

    if (isRecord(item) && typeof item.text === 'string') {
      const record = item;
      const text = item.text.trim();
      if (!text) {
        return result;
      }

      let englishText: string | undefined;
      if (typeof item.englishText === 'string') {
        englishText = item.englishText.trim();
      } else if (typeof record.textEn === 'string') {
        englishText = record.textEn.trim();
      } else if (typeof record.enText === 'string') {
        englishText = record.enText.trim();
      }

      result.push({
        text,
        mode: item.mode === 'insert' ? 'insert' : 'send',
        englishText: englishText || undefined,
      });
    }

    return result;
  }, []);
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNumericString(value: unknown): string | undefined {
  const str = toTrimmedString(value);
  if (!str) return undefined;
  return /^\d+$/.test(str) ? str : undefined;
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
    newAlertThreadId: toNumericString(source.newAlertThreadId),
    holdingAlertChatId: toTrimmedString(source.holdingAlertChatId),
    holdingAlertThreadId: toNumericString(source.holdingAlertThreadId),
    highestAlertChatId: toTrimmedString(source.highestAlertChatId),
    highestAlertThreadId: toNumericString(source.highestAlertThreadId),
    processingAlertChatId: toTrimmedString(source.processingAlertChatId),
    processingAlertThreadId: toNumericString(source.processingAlertThreadId),
    resolvedAlertChatId: toTrimmedString(source.resolvedAlertChatId),
    resolvedAlertThreadId: toNumericString(source.resolvedAlertThreadId),
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
    customerResolvePatterns: normalizeStringArray(
      source.customerResolvePatterns,
      defaults.customerResolvePatterns,
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
