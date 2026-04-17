import type { CustomerServiceSettings } from '../../types/customerServiceV2';

import { getCurrentTabId } from '../../../util/establishMultitabRole';
import { getTranslationFn } from '../../../util/localization';
import { fetchCustomerServiceCloudConfig, uploadCustomerServiceCloudConfig } from '../../../api/customerServiceSync';
import {
  computeCustomerServiceSettingsHash,
  loadCustomerServiceCloudSyncPreference,
  maskCloudSyncToken,
  updateCustomerServiceCloudSyncPreferenceForToken,
} from '../../helpers/customerServiceCloudSyncPreference';
import {
  loadCustomerServiceV2SettingsFromStorage,
  saveCustomerServiceV2SettingsToStorage,
} from '../../helpers/customerServiceV2Settings';
import { addActionHandler, getGlobal, setGlobal } from '../../index';
import {
  ensureCustomerServiceV2State,
  getDefaultCustomerServiceV2Settings,
  logCustomerServiceCloudSyncDebug,
  normalizeSettingsForSave,
  ownersMatch,
  updateCustomerServiceV2State,
} from './customerServiceV2Helpers';

let isAutoSyncCustomerServiceV2CloudInFlight = false;

addActionHandler('syncCustomerServiceV2Cloud', async (global, actions, payload): Promise<void> => {
  const translate = getTranslationFn();
  const {
    token,
    operation = 'auto',
    existingData,
    localSettings,
    onExisting,
    onDownload,
    onUpload,
    onError,
  } = payload || {};

  const trimmedToken = token?.trim();
  if (!trimmedToken) {
    onError?.(new Error('Sync token is required'));
    return;
  }

  const currentUserId = global.currentUserId ? String(global.currentUserId) : undefined;
  const preference = loadCustomerServiceCloudSyncPreference();

  const getLocalSettings = () => (
    localSettings
    || global.customerServiceV2?.settings
    || loadCustomerServiceV2SettingsFromStorage()
    || getDefaultCustomerServiceV2Settings()
  );

  const updatePreferenceMetadata = (normalizedSettings: CustomerServiceSettings, meta?: {
    ownerId?: string;
    version?: number;
    updatedAt?: number;
  }) => {
    updateCustomerServiceCloudSyncPreferenceForToken(trimmedToken, (prev) => ({
      ...prev,
      ownerId: meta?.ownerId ?? prev.ownerId,
      lastVersion: meta?.version ?? prev.lastVersion,
      lastUpdatedAt: meta?.updatedAt ?? prev.lastUpdatedAt,
      lastSettingsHash: computeCustomerServiceSettingsHash(normalizedSettings),
    }));
  };

  const persistSettings = (nextSettings: CustomerServiceSettings, meta?: {
    ownerId?: string;
    version?: number;
    updatedAt?: number;
    canUpdate?: boolean;
  }) => {
    const normalized = normalizeSettingsForSave(nextSettings);
    saveCustomerServiceV2SettingsToStorage(normalized);

    global = updateCustomerServiceV2State(global, {
      ...ensureCustomerServiceV2State(global.customerServiceV2),
      settings: normalized,
    });

    setGlobal(global);
    updatePreferenceMetadata(normalized, meta);
    onDownload?.({
      ownerId: meta?.ownerId,
      version: meta?.version,
      updatedAt: meta?.updatedAt,
      canUpdate: meta?.canUpdate,
    });
  };

  try {
    if (operation === 'upload') {
      if (!currentUserId) {
        throw new Error(translate('CustomerServiceCloudSyncNotLoggedIn'));
      }

      const normalizedLocal = normalizeSettingsForSave(getLocalSettings());
      const localHash = computeCustomerServiceSettingsHash(normalizedLocal);
      const shouldSkipUpload = preference?.token === trimmedToken
        && preference.lastSettingsHash === localHash;

      if (shouldSkipUpload) {
        logCustomerServiceCloudSyncDebug('sync:skipUploadUnchanged', {
          token: maskCloudSyncToken(trimmedToken),
          ownerId: currentUserId,
        });
        return;
      }

      const response = await uploadCustomerServiceCloudConfig(trimmedToken, {
        ownerId: currentUserId,
        settings: normalizedLocal,
      });

      updatePreferenceMetadata(normalizedLocal, {
        ownerId: currentUserId,
        version: response.version,
        updatedAt: response.updatedAt,
      });

      onUpload?.({
        version: response.version,
        updatedAt: response.updatedAt,
      });
      return;
    }

    if (operation === 'download') {
      let cloud = existingData;
      if (!cloud) {
        const fetched = await fetchCustomerServiceCloudConfig(trimmedToken, currentUserId);
        if (!fetched?.settings) {
          throw new Error(translate('CustomerServiceCloudSyncConfigNotFound'));
        }

        cloud = {
          settings: normalizeSettingsForSave(fetched.settings as CustomerServiceSettings),
          ownerId: fetched.ownerId,
          version: fetched.version,
          updatedAt: fetched.updatedAt,
          canUpdate: fetched.canUpdate,
        };
      }

      persistSettings(cloud.settings, {
        ownerId: cloud.ownerId,
        version: cloud.version,
        updatedAt: cloud.updatedAt,
        canUpdate: cloud.canUpdate,
      });
      return;
    }

    const existing = await fetchCustomerServiceCloudConfig(trimmedToken, currentUserId);
    if (existing?.settings) {
      const ownerId = existing.ownerId ? String(existing.ownerId) : undefined;
      const normalizedIncoming = normalizeSettingsForSave(existing.settings as CustomerServiceSettings);
      const canUpdate = existing.canUpdate ?? ownersMatch(ownerId, currentUserId);

      if (canUpdate) {
        onExisting?.({
          ownerId,
          version: existing.version,
          updatedAt: existing.updatedAt,
          settings: normalizedIncoming,
          canUpdate,
        });
        return;
      }

      persistSettings(normalizedIncoming, {
        ownerId,
        version: existing.version,
        updatedAt: existing.updatedAt,
        canUpdate,
      });
      return;
    }

    if (!currentUserId) {
      throw new Error(translate('CustomerServiceCloudSyncNotLoggedIn'));
    }

    const normalizedLocal = normalizeSettingsForSave(getLocalSettings());
    const response = await uploadCustomerServiceCloudConfig(trimmedToken, {
      ownerId: currentUserId,
      settings: normalizedLocal,
    });

    updatePreferenceMetadata(normalizedLocal, {
      ownerId: currentUserId,
      version: response.version,
      updatedAt: response.updatedAt,
    });

    onUpload?.({
      version: response.version,
      updatedAt: response.updatedAt,
    });
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error('Cloud sync failed'));
  }
});

addActionHandler('autoSyncCustomerServiceV2Cloud', async (global, actions, payload): Promise<void> => {
  const { tabId = getCurrentTabId(), silent = false } = payload || {};
  const preference = loadCustomerServiceCloudSyncPreference();
  if (!preference?.token) {
    return;
  }

  const trimmedToken = preference.token.trim();
  if (!trimmedToken) {
    return;
  }

  const currentUserId = global.currentUserId ? String(global.currentUserId) : undefined;
  const translate = getTranslationFn();

  if (isAutoSyncCustomerServiceV2CloudInFlight) {
    logCustomerServiceCloudSyncDebug('autoSync:skipInFlight', {
      tabId,
      token: maskCloudSyncToken(trimmedToken),
      silent,
    });
    return;
  }

  isAutoSyncCustomerServiceV2CloudInFlight = true;

  logCustomerServiceCloudSyncDebug('autoSync:start', {
    tabId,
    token: maskCloudSyncToken(trimmedToken),
    preferenceVersion: preference.lastVersion,
    preferenceHash: preference.lastSettingsHash,
    preferenceOwnerId: preference.ownerId,
    currentUserId,
    silent,
  });

  const persistDownloadedSettings = (settings: CustomerServiceSettings, meta?: {
    ownerId?: string;
    version?: number;
    updatedAt?: number;
  }) => {
    const normalized = normalizeSettingsForSave(settings);
    saveCustomerServiceV2SettingsToStorage(normalized);

    global = getGlobal();
    global = updateCustomerServiceV2State(global, {
      ...ensureCustomerServiceV2State(global.customerServiceV2),
      settings: normalized,
    });
    setGlobal(global);

    updateCustomerServiceCloudSyncPreferenceForToken(trimmedToken, (prev) => ({
      ...prev,
      ownerId: meta?.ownerId ?? prev.ownerId,
      lastVersion: meta?.version ?? prev.lastVersion,
      lastUpdatedAt: meta?.updatedAt ?? prev.lastUpdatedAt,
      lastSettingsHash: computeCustomerServiceSettingsHash(normalized),
    }));

    logCustomerServiceCloudSyncDebug('autoSync:applyCloudSettings', {
      token: maskCloudSyncToken(trimmedToken),
      version: meta?.version,
      ownerId: meta?.ownerId,
      updatedAt: meta?.updatedAt,
    });

    if (!silent) {
      actions.showNotification({
        message: translate('CustomerServiceCloudSyncUpdated'),
        tabId,
      });
    }
  };

  try {
    const cloud = await fetchCustomerServiceCloudConfig(trimmedToken, currentUserId);
    if (!cloud?.settings) {
      logCustomerServiceCloudSyncDebug('autoSync:noCloudSettings', {
        token: maskCloudSyncToken(trimmedToken),
      });
      return;
    }

    const ownerId = cloud.ownerId ? String(cloud.ownerId) : undefined;
    const normalizedIncoming = normalizeSettingsForSave(cloud.settings as CustomerServiceSettings);
    const incomingHash = computeCustomerServiceSettingsHash(normalizedIncoming);
    const remoteVersion = typeof cloud.version === 'number' ? cloud.version : 0;
    const lastVersion = preference.lastVersion || 0;
    const hasRemoteChanged = preference.lastVersion !== remoteVersion
      || preference.lastSettingsHash !== incomingHash;

    const canUpdate = cloud.canUpdate ?? ownersMatch(ownerId, currentUserId);

    logCustomerServiceCloudSyncDebug('autoSync:fetched', {
      token: maskCloudSyncToken(trimmedToken),
      ownerId,
      remoteVersion,
      lastVersion,
      canUpdate,
      hasRemoteChanged,
      incomingHash,
      storedHash: preference.lastSettingsHash,
    });

    if (!canUpdate) {
      if (hasRemoteChanged) {
        persistDownloadedSettings(normalizedIncoming, {
          ownerId,
          version: remoteVersion,
          updatedAt: cloud.updatedAt,
        });
      } else {
        updateCustomerServiceCloudSyncPreferenceForToken(trimmedToken, (prev) => ({
          ...prev,
          ownerId: ownerId ?? prev.ownerId,
          lastVersion: remoteVersion,
          lastUpdatedAt: cloud.updatedAt ?? prev.lastUpdatedAt,
          lastSettingsHash: incomingHash,
        }));
        logCustomerServiceCloudSyncDebug('autoSync:noChangeNonOwner', {
          token: maskCloudSyncToken(trimmedToken),
          remoteVersion,
        });
      }
      return;
    }

    if (hasRemoteChanged && remoteVersion > lastVersion) {
      persistDownloadedSettings(normalizedIncoming, {
        ownerId: ownerId || currentUserId,
        version: remoteVersion,
        updatedAt: cloud.updatedAt,
      });
      return;
    }

    updateCustomerServiceCloudSyncPreferenceForToken(trimmedToken, (prev) => ({
      ...prev,
      ownerId: ownerId ?? prev.ownerId ?? currentUserId,
      lastVersion: remoteVersion,
      lastUpdatedAt: cloud.updatedAt ?? prev.lastUpdatedAt,
      lastSettingsHash: incomingHash,
    }));
    logCustomerServiceCloudSyncDebug('autoSync:noChangeOwner', {
      token: maskCloudSyncToken(trimmedToken),
      remoteVersion,
    });
  } catch (error) {
    logCustomerServiceCloudSyncDebug('autoSync:error', {
      token: maskCloudSyncToken(preference.token),
      error,
    });
    if (!silent) {
      actions.showNotification({
        message: translate('CustomerServiceCloudSyncFailed'),
        tabId,
      });
    }
  } finally {
    isAutoSyncCustomerServiceV2CloudInFlight = false;
  }
});
