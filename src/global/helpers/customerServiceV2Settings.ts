import type {
  CustomerServiceQuickReply,
  CustomerServiceSettings,
  UserRule,
} from '../types/customerServiceV2';

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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCustomerServiceQuickReplies(raw: unknown): CustomerServiceQuickReply[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<CustomerServiceQuickReply[]>((result, item) => {
    if (item === undefined || item === null) {
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
      const record = item as Record<string, unknown>;
      const text = item.text.trim();
      if (!text) {
        return result;
      }

      let englishText: string | undefined;
      if (typeof item.englishText === 'string') {
        englishText = item.englishText.trim();
      } else if (typeof record.textEn === 'string') {
        englishText = (record.textEn as string).trim();
      } else if (typeof record.enText === 'string') {
        englishText = (record.enText as string).trim();
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
