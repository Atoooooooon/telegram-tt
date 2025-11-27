import type { CustomerServiceSettings } from '../types/customerServiceV2';

const CUSTOMER_SERVICE_V2_SETTINGS_KEY = 'customerServiceV2Settings';
const LEGACY_CUSTOMER_SERVICE_SETTINGS_KEY = 'customerServiceSettings';

type NormalizableSettings = {
  monitoredChatIds?: unknown;
  filteredUserIds?: unknown;
  regexFilters?: unknown;
  mode?: unknown;
  autoRead?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  const settings = readFromStorage(CUSTOMER_SERVICE_V2_SETTINGS_KEY);
  if (settings) {
    return settings;
  }

  return readFromStorage(LEGACY_CUSTOMER_SERVICE_SETTINGS_KEY);
}

export function saveCustomerServiceV2SettingsToStorage(settings: CustomerServiceSettings) {
  try {
    localStorage.setItem(CUSTOMER_SERVICE_V2_SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    // Ignore storage errors
  }
}
