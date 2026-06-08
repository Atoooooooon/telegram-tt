import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import { memo, useEffect, useMemo, useState } from '../../../../../lib/teact/teact';

import type {
  CustomerServiceExternalAiProfile,
  CustomerServiceExternalAiProfileRole,
  CustomerServiceExternalAiProvider,
  CustomerServiceExternalSettings,
} from '../../../../../global/types/customerServiceV2';

import {
  DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT,
  DEFAULT_GEMINI_AI_BASE_URL,
  DEFAULT_GEMINI_AI_MODEL,
  normalizeCustomerServiceExternalSettings,
} from '../../../../../global/helpers/customerServiceV2Settings';
import buildClassName from '../../../../../util/buildClassName';

import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';
import Select from '../../../../ui/Select';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './ExternalServicesTab.module.scss';

type Props = {
  external?: CustomerServiceExternalSettings;
  onChange: (next: CustomerServiceExternalSettings) => void;
};

const AI_PROVIDER_OPTIONS: Array<{
  value: CustomerServiceExternalAiProvider;
  label: string;
}> = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
];

const AI_ROLE_OPTIONS: Array<{
  value: CustomerServiceExternalAiProfileRole;
  label: string;
}> = [
  { value: 'general', label: '通用机器人' },
  { value: 'business', label: '业务机器人' },
];

function buildNewProfile(index: number): CustomerServiceExternalAiProfile {
  return {
    id: `ai-profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `业务机器人 ${index}`,
    provider: 'deepseek',
    enabled: false,
    role: 'business',
    businessKey: '',
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-v4-flash',
    systemPrompt: DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 1500,
  };
}

function cloneProfile(profile: CustomerServiceExternalAiProfile, index: number): CustomerServiceExternalAiProfile {
  return {
    ...profile,
    id: `ai-profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${profile.name || 'AI 配置'} 副本 ${index}`,
    enabled: false,
  };
}

function parseOptionalNumber(value: string): number | undefined {
  if (!value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getProviderDefaultBaseUrl(provider: CustomerServiceExternalAiProvider) {
  if (provider === 'deepseek') {
    return 'https://api.deepseek.com';
  }

  if (provider === 'gemini') {
    return DEFAULT_GEMINI_AI_BASE_URL;
  }

  return '';
}

function getProviderDefaultModel(provider: CustomerServiceExternalAiProvider) {
  if (provider === 'deepseek') {
    return 'deepseek-v4-flash';
  }

  if (provider === 'gemini') {
    return DEFAULT_GEMINI_AI_MODEL;
  }

  return '';
}

function getDefaultBaseUrlForProvider(
  provider: CustomerServiceExternalAiProvider,
  currentBaseUrl: string,
  previousProvider: CustomerServiceExternalAiProvider,
) {
  const trimmed = currentBaseUrl.trim();
  const previousDefault = getProviderDefaultBaseUrl(previousProvider);

  if (trimmed && trimmed !== previousDefault) {
    return currentBaseUrl;
  }

  return getProviderDefaultBaseUrl(provider);
}

function getDefaultModelForProvider(
  provider: CustomerServiceExternalAiProvider,
  currentModel: string,
  previousProvider: CustomerServiceExternalAiProvider,
) {
  const trimmed = currentModel.trim();
  const previousDefault = getProviderDefaultModel(previousProvider);

  if (trimmed && trimmed !== previousDefault) {
    return currentModel;
  }

  return getProviderDefaultModel(provider);
}

const ExternalServicesTab: FC<Props> = ({ external, onChange }) => {
  const normalizedExternal = useMemo(() => normalizeCustomerServiceExternalSettings(external), [external]);
  const profiles = normalizedExternal.aiProfiles || [];
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(
    normalizedExternal.defaultAiProfileId || profiles[0]?.id,
  );

  useEffect(() => {
    if (!profiles.length) {
      setSelectedProfileId(undefined);
      return;
    }

    if (!selectedProfileId || !profiles.some((profile) => profile.id === selectedProfileId)) {
      setSelectedProfileId(normalizedExternal.defaultAiProfileId || profiles[0].id);
    }
  }, [normalizedExternal.defaultAiProfileId, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || profiles[0];

  const emitProfiles = useLastCallback((
    nextProfiles: CustomerServiceExternalAiProfile[],
    nextDefaultAiProfileId?: string,
  ) => {
    const normalized = normalizeCustomerServiceExternalSettings({
      ...normalizedExternal,
      aiProfiles: nextProfiles,
      defaultAiProfileId: nextDefaultAiProfileId || normalizedExternal.defaultAiProfileId,
    });
    onChange(normalized);
  });

  const updateSelectedProfile = useLastCallback((
    updater: (profile: CustomerServiceExternalAiProfile) => CustomerServiceExternalAiProfile,
  ) => {
    if (!selectedProfile) {
      return;
    }

    const previousId = selectedProfile.id;
    let nextSelectedProfileId = previousId;
    const nextProfiles = profiles.map((profile) => {
      if (profile.id !== previousId) {
        return profile;
      }

      const nextProfile = updater(profile);
      nextSelectedProfileId = nextProfile.id || previousId;
      return nextProfile;
    });
    const nextDefaultAiProfileId = normalizedExternal.defaultAiProfileId === previousId
      ? nextSelectedProfileId
      : normalizedExternal.defaultAiProfileId;

    setSelectedProfileId(nextSelectedProfileId);
    emitProfiles(nextProfiles, nextDefaultAiProfileId);
  });

  const handleAddProfile = useLastCallback(() => {
    const nextProfile = buildNewProfile(profiles.length + 1);
    setSelectedProfileId(nextProfile.id);
    emitProfiles([...profiles, nextProfile], normalizedExternal.defaultAiProfileId || nextProfile.id);
  });

  const handleDuplicateProfile = useLastCallback(() => {
    if (!selectedProfile) {
      return;
    }

    const nextProfile = cloneProfile(selectedProfile, profiles.length + 1);
    setSelectedProfileId(nextProfile.id);
    emitProfiles([...profiles, nextProfile], normalizedExternal.defaultAiProfileId || nextProfile.id);
  });

  const handleDeleteProfile = useLastCallback(() => {
    if (!selectedProfile || profiles.length <= 1) {
      return;
    }

    const nextProfiles = profiles.filter((profile) => profile.id !== selectedProfile.id);
    const nextSelectedId = nextProfiles[0]?.id;
    setSelectedProfileId(nextSelectedId);
    emitProfiles(nextProfiles, normalizedExternal.defaultAiProfileId === selectedProfile.id
      ? nextSelectedId
      : normalizedExternal.defaultAiProfileId);
  });

  const handleSetDefault = useLastCallback(() => {
    if (!selectedProfile) {
      return;
    }

    emitProfiles(profiles, selectedProfile.id);
  });

  const handleProviderChange = useLastCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const provider = event.currentTarget.value as CustomerServiceExternalAiProvider;
    updateSelectedProfile((profile) => ({
      ...profile,
      provider,
      baseUrl: getDefaultBaseUrlForProvider(provider, profile.baseUrl, profile.provider),
      model: getDefaultModelForProvider(provider, profile.model, profile.provider),
    }));
  });

  const handleRoleChange = useLastCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const role = event.currentTarget.value as CustomerServiceExternalAiProfileRole;
    updateSelectedProfile((profile) => ({
      ...profile,
      role,
      businessKey: role === 'business' ? profile.businessKey : undefined,
    }));
  });

  return (
    <div className={layoutStyles.tabContent}>
      <div className={layoutStyles.sectionHeader}>
        <h3>
          <Icon name="bots" className={layoutStyles.sectionIcon} />
          外部配置
        </h3>
        <p className={layoutStyles.sectionDescription}>
          API Key、模型、服务地址集中放在这里。自动化只引用 Profile ID 编排能力。
        </p>
      </div>

      <div className={styles.externalLayout}>
        <aside className={styles.profilePane}>
          <div className={styles.profilePaneHeader}>
            <div>
              <strong className={styles.profilePaneTitle}>AI Profiles</strong>
              <span className={styles.profilePaneHint}>
                {profiles.length}
                {' '}
                套配置
              </span>
            </div>
            <Button
              round
              size="tiny"
              color="primary"
              onClick={handleAddProfile}
              ariaLabel="新增 AI 配置"
            >
              <Icon name="add" />
            </Button>
          </div>

          <div className={styles.profileList}>
            {profiles.map((profile) => {
              const isSelected = selectedProfile?.id === profile.id;
              const isDefault = normalizedExternal.defaultAiProfileId === profile.id;

              return (
                <button
                  key={profile.id}
                  type="button"
                  className={buildClassName(
                    styles.profileItem,
                    isSelected && styles.profileItemSelected,
                  )}
                  onClick={() => setSelectedProfileId(profile.id)}
                >
                  <span className={styles.profileItemHeader}>
                    <strong>{profile.name || profile.id}</strong>
                    {isDefault && <span className={styles.defaultBadge}>默认</span>}
                  </span>
                  <span className={styles.profileItemMeta}>
                    {profile.role === 'business' ? '业务' : '通用'}
                    {' · '}
                    {profile.model || '未设置模型'}
                  </span>
                  <span className={buildClassName(
                    styles.profileState,
                    profile.enabled && styles.profileStateEnabled,
                  )}
                  >
                    {profile.enabled ? '已启用' : '未启用'}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {selectedProfile && (
          <section className={styles.editorPane}>
            <div className={styles.editorHeader}>
              <div>
                <strong className={styles.editorTitle}>{selectedProfile.name || 'AI 配置'}</strong>
                <span className={styles.editorHint}>{selectedProfile.id}</span>
              </div>
              <div className={styles.editorActions}>
                <Button
                  className={styles.editorActionButton}
                  size="tiny"
                  color="translucent"
                  onClick={handleSetDefault}
                  disabled={normalizedExternal.defaultAiProfileId === selectedProfile.id}
                >
                  <Icon name="check" />
                  设为默认
                </Button>
                <Button
                  className={styles.editorActionButton}
                  size="tiny"
                  color="translucent"
                  onClick={handleDuplicateProfile}
                >
                  <Icon name="copy" />
                  复制
                </Button>
                <Button
                  className={styles.editorActionButton}
                  size="tiny"
                  color="translucent"
                  onClick={handleDeleteProfile}
                  disabled={profiles.length <= 1}
                  ariaLabel="删除 AI 配置"
                >
                  <Icon name="delete" />
                </Button>
              </div>
            </div>

            <div className={styles.enableRow}>
              <div>
                <strong>启用这个机器人</strong>
                <span>未启用时不会被工作台和规则能力自动选择。</span>
              </div>
              <Switcher
                label="启用 AI Profile"
                checked={Boolean(selectedProfile.enabled)}
                onCheck={(enabled) => updateSelectedProfile((profile) => ({
                  ...profile,
                  enabled,
                }))}
              />
            </div>

            <div className={styles.formGrid}>
              <InputText
                label="名称"
                value={selectedProfile.name}
                className={styles.inputField}
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  name: event.currentTarget.value,
                }))}
              />
              <InputText
                label="Profile ID"
                value={selectedProfile.id}
                className={styles.inputField}
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  id: event.currentTarget.value,
                }))}
              />
              <Select
                label="用途"
                value={selectedProfile.role || 'general'}
                onChange={handleRoleChange}
              >
                {AI_ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <InputText
                label="业务 Key"
                value={selectedProfile.businessKey || ''}
                disabled={(selectedProfile.role || 'general') !== 'business'}
                className={styles.inputField}
                placeholder="如 recharge/order/risk"
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  businessKey: event.currentTarget.value,
                }))}
              />
              <Select
                label="服务商"
                value={selectedProfile.provider}
                onChange={handleProviderChange}
              >
                {AI_PROVIDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <InputText
                label="Base URL"
                value={selectedProfile.baseUrl}
                className={styles.inputField}
                placeholder="https://api.deepseek.com"
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  baseUrl: event.currentTarget.value,
                }))}
              />
              <InputText
                label="模型"
                value={selectedProfile.model}
                className={styles.inputField}
                placeholder="deepseek-v4-flash"
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  model: event.currentTarget.value,
                }))}
              />
              <label className={styles.secretField}>
                <input
                  type="password"
                  value={selectedProfile.apiKey}
                  placeholder="sk-..."
                  autoComplete="off"
                  onChange={(event) => updateSelectedProfile((profile) => ({
                    ...profile,
                    apiKey: event.currentTarget.value,
                  }))}
                />
                <span>API Key</span>
              </label>
              <InputText
                label="Temperature"
                value={selectedProfile.temperature === undefined ? '' : String(selectedProfile.temperature)}
                className={styles.inputField}
                inputMode="decimal"
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  temperature: parseOptionalNumber(event.currentTarget.value),
                }))}
              />
              <InputText
                label="Max Tokens"
                value={selectedProfile.maxTokens === undefined ? '' : String(selectedProfile.maxTokens)}
                className={styles.inputField}
                inputMode="numeric"
                onChange={(event) => updateSelectedProfile((profile) => ({
                  ...profile,
                  maxTokens: parseOptionalNumber(event.currentTarget.value),
                }))}
              />
            </div>

            <TextArea
              label="系统提示词"
              className={styles.systemPrompt}
              value={selectedProfile.systemPrompt || ''}
              autoResize={false}
              noReplaceNewlines
              onChange={(event) => updateSelectedProfile((profile) => ({
                ...profile,
                systemPrompt: event.currentTarget.value,
              }))}
            />

            <div className={styles.ruleHint}>
              <Icon name="info" />
              <span>
                规则里使用
                {' '}
                <code>{selectedProfile.id}</code>
                {' '}
                作为
                {' '}
                <code>profileId</code>
                ，不要再把 API Key 写进规则 JSON。
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default memo(ExternalServicesTab);
