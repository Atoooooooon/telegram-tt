import type { CustomerServiceSettings } from '../types/customerServiceV2';

const STORAGE_KEY = 'customerServiceCloudSyncPreference';

export function maskCloudSyncToken(token?: string) {
  if (!token) {
    return undefined;
  }

  if (token.length <= 6) {
    return `${token[0] ?? ''}***${token[token.length - 1] ?? ''}`;
  }

  return `${token.slice(0, 3)}***${token.slice(-2)}`;
}

function logCloudSyncPreferenceDebug(...args: unknown[]) {
  if (typeof console === 'undefined') {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[CustomerServiceCloudPref]', ...args);
}

export type CustomerServiceCloudSyncPreference = {
  token: string;
  mode: 'listen';
  ownerId?: string;
  lastVersion?: number;
  lastUpdatedAt?: number;
  lastSettingsHash?: string;
};

function readPreference(): CustomerServiceCloudSyncPreference | undefined {
  if (typeof localStorage === 'undefined') {
    return undefined;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return undefined;
    }

    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }

    if (typeof parsed.token !== 'string' || parsed.mode !== 'listen') {
      return undefined;
    }

    return {
      token: parsed.token,
      mode: 'listen',
      ownerId: typeof parsed.ownerId === 'string' ? parsed.ownerId : undefined,
      lastVersion: typeof parsed.lastVersion === 'number' ? parsed.lastVersion : undefined,
      lastUpdatedAt: typeof parsed.lastUpdatedAt === 'number' ? parsed.lastUpdatedAt : undefined,
      lastSettingsHash: typeof parsed.lastSettingsHash === 'string' ? parsed.lastSettingsHash : undefined,
    };
  } catch (error) {
    return undefined;
  }
}

function writePreference(preference?: CustomerServiceCloudSyncPreference) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  if (!preference || !preference.token || preference.mode !== 'listen') {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  try {
    const payload = {
      ...preference,
      token: preference.token.trim(),
      mode: 'listen' as const,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    logCloudSyncPreferenceDebug('writePreference', {
      token: maskCloudSyncToken(payload.token),
      ownerId: payload.ownerId,
      lastVersion: payload.lastVersion,
      lastUpdatedAt: payload.lastUpdatedAt,
    });
  } catch (error) {
    // Ignore write errors
  }
}

export function loadCustomerServiceCloudSyncPreference(): CustomerServiceCloudSyncPreference | undefined {
  const preference = readPreference();
  if (!preference?.token) {
    return undefined;
  }

  const trimmed = preference.token.trim();
  if (!trimmed) {
    return undefined;
  }

  return {
    ...preference,
    token: trimmed,
  };
}

export function saveCustomerServiceCloudSyncPreference(preference?: CustomerServiceCloudSyncPreference) {
  writePreference(preference && preference.token.trim() ? {
    ...preference,
    token: preference.token.trim(),
    mode: 'listen',
  } : undefined);
}

export function clearCustomerServiceCloudSyncPreference() {
  writePreference(undefined);
}

export function updateCustomerServiceCloudSyncPreference(
  updater: (prev?: CustomerServiceCloudSyncPreference) => CustomerServiceCloudSyncPreference | undefined,
) {
  const prev = loadCustomerServiceCloudSyncPreference();
  const next = updater(prev);
  saveCustomerServiceCloudSyncPreference(next);
  return next;
}

export function updateCustomerServiceCloudSyncPreferenceForToken(
  token: string,
  updater: (prev: CustomerServiceCloudSyncPreference) => CustomerServiceCloudSyncPreference,
) {
  updateCustomerServiceCloudSyncPreference((prev) => {
    // If there is no previous preference or the token changed, start from a fresh base
    const base: CustomerServiceCloudSyncPreference = prev && prev.token === token
      ? prev
      : {
        token,
        mode: 'listen',
      };

    const next = updater(base);
    logCloudSyncPreferenceDebug('updatePreferenceForToken', {
      token: maskCloudSyncToken(token),
      prevLastVersion: base.lastVersion,
      nextLastVersion: next.lastVersion,
      prevHash: base.lastSettingsHash,
      nextHash: next.lastSettingsHash,
    });
    return next;
  });
}

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);

    hash |= 0;
  }

  return (hash >>> 0).toString(16);
}

export function computeCustomerServiceSettingsHash(settings: CustomerServiceSettings): string {
  try {
    return djb2Hash(JSON.stringify(settings));
  } catch (error) {
    return '';
  }
}
