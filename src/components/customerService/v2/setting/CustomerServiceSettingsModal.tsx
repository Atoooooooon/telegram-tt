import { memo, useEffect, useMemo, useState } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiChat, ApiChatFullInfo } from '../../../../api/types';
import type {
  CustomerServiceKnownChat,
  CustomerServiceOncallSettings,
  CustomerServiceQuickReply,
  UserRule,
} from '../../../../global/types/customerServiceV2';
import type { TopicsInfo } from '../../../../types';

import { CUSTOMER_SERVICE_CONFIG } from '../../../../config/customerService';
import {
  buildCustomerServiceKnownChats,
  normalizeCustomerServiceOncallSettings,
  normalizeCustomerServiceQuickReplies,
} from '../../../../global/helpers/customerServiceV2Settings';
import { selectCustomerServiceV2Settings } from '../../../../global/selectors/customerServiceV2';
import { selectTabState } from '../../../../global/selectors/tabs';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Icon from '../../../common/icons/Icon';
import Button from '../../../ui/Button';
import Checkbox from '../../../ui/Checkbox';
import Modal from '../../../ui/Modal';
import TabList from '../../../ui/TabList';
import CustomerServiceCloudSyncModal from './CustomerServiceCloudSyncModal';
import GroupFiltersTab from './tabs/GroupFiltersTab';
import MessageFiltersTab from './tabs/MessageFiltersTab';
import OncallGuaranteeTab from './tabs/OncallGuaranteeTab';
import QuickRepliesTab from './tabs/QuickRepliesTab';
import RuleEngineTab from './tabs/RuleEngineTab';
import UserFiltersTab from './tabs/UserFiltersTab';

import styles from './CustomerServiceSettingsModal.module.scss';

type StateProps = {
  isOpen?: boolean;
  chats: Record<string, ApiChat>;
  chatFullInfos: Record<string, ApiChatFullInfo>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  users: Record<string, any>;
  chatFolders: Record<number, any>;
  orderedFolderIds?: number[];
  savedSettings?: {
    monitoredChatIds: string[];
    filteredUserIds: string[];
    regexFilters: Array<{
      source: string;
      flags: string;
    }>;
    mode?: 'oncall' | 'assist';
    autoRead?: boolean;
    quickReplies?: CustomerServiceQuickReply[];
    quickReplyPanelGlobal?: boolean;
    rules?: UserRule[];
    oncall?: CustomerServiceOncallSettings;
    knownChats?: Record<string, CustomerServiceKnownChat>;
  };
};

type FilterSettings = {
  monitoredChatIds: string[];
  filteredUserIds: string[];
  regexFilters: RegExp[];
  mode?: 'oncall' | 'assist';
  autoRead?: boolean;
  quickReplies: CustomerServiceQuickReply[];
  quickReplyPanelGlobal: boolean;
  rules: UserRule[];
  oncall: CustomerServiceOncallSettings;
  knownChats?: Record<string, CustomerServiceKnownChat>;
};

type SavedSettings = StateProps['savedSettings'];
type NormalizedSettings = {
  monitoredChatIds: string[];
  filteredUserIds: string[];
  regexFilters: Array<{ source: string; flags: string }>;
  mode: 'oncall' | 'assist';
  autoRead: boolean;
  quickReplies: CustomerServiceQuickReply[];
  quickReplyPanelGlobal: boolean;
  rules: UserRule[];
  oncall: CustomerServiceOncallSettings;
  knownChats?: Record<string, CustomerServiceKnownChat>;
};

const buildFilterSettings = (saved?: SavedSettings): FilterSettings => ({
  monitoredChatIds: saved?.monitoredChatIds
    ? [...saved.monitoredChatIds]
    : Array.from(CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS),
  filteredUserIds: saved?.filteredUserIds
    ? [...saved.filteredUserIds]
    : Array.from(CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS),
  regexFilters: saved?.regexFilters
    ? saved.regexFilters.map((pattern) => new RegExp(pattern.source, pattern.flags))
    : [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS],
  mode: saved?.mode || 'oncall',
  autoRead: saved?.autoRead || false,
  quickReplies: normalizeCustomerServiceQuickReplies(saved?.quickReplies ?? CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES),
  quickReplyPanelGlobal: Boolean(saved?.quickReplyPanelGlobal),
  rules: (saved?.rules && saved.rules.length
    ? saved.rules.map((rule) => JSON.parse(JSON.stringify(rule)))
    : []) as UserRule[],
  oncall: normalizeCustomerServiceOncallSettings(saved?.oncall),
  knownChats: saved?.knownChats ? JSON.parse(JSON.stringify(saved.knownChats)) : undefined,
});

const buildNormalizedSettings = (
  settings: FilterSettings,
  chats: Record<string, ApiChat>,
): NormalizedSettings => {
  const oncall = normalizeCustomerServiceOncallSettings(settings.oncall);

  return {
    monitoredChatIds: [...settings.monitoredChatIds],
    filteredUserIds: [...settings.filteredUserIds],
    regexFilters: settings.regexFilters.map((regex) => ({
      source: regex.source,
      flags: regex.flags,
    })),
    mode: settings.mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(settings.autoRead),
    quickReplies: normalizeCustomerServiceQuickReplies(settings.quickReplies),
    quickReplyPanelGlobal: Boolean(settings.quickReplyPanelGlobal),
    rules: settings.rules?.length ? JSON.parse(JSON.stringify(settings.rules)) : [],
    oncall,
    knownChats: buildCustomerServiceKnownChats({
      existing: settings.knownChats,
      chats,
      monitoredChatIds: settings.monitoredChatIds,
      oncall,
    }),
  };
};

const buildNormalizedSavedSettings = (saved?: SavedSettings): NormalizedSettings | undefined => {
  if (!saved) {
    return undefined;
  }

  return {
    monitoredChatIds: saved.monitoredChatIds ? [...saved.monitoredChatIds] : [],
    filteredUserIds: saved.filteredUserIds ? [...saved.filteredUserIds] : [],
    regexFilters: saved.regexFilters
      ? saved.regexFilters.map((filter) => ({ source: filter.source, flags: filter.flags }))
      : [],
    mode: saved.mode === 'assist' ? 'assist' : 'oncall',
    autoRead: Boolean(saved.autoRead),
    quickReplies: normalizeCustomerServiceQuickReplies(saved.quickReplies ?? []),
    quickReplyPanelGlobal: Boolean(saved.quickReplyPanelGlobal),
    rules: saved.rules?.length ? JSON.parse(JSON.stringify(saved.rules)) : [],
    oncall: normalizeCustomerServiceOncallSettings(saved.oncall),
    knownChats: saved.knownChats ? JSON.parse(JSON.stringify(saved.knownChats)) : undefined,
  };
};

const stripRuleEnabled = (rules: UserRule[]) => (
  rules.map(({ enabled: _enabled, ...rest }) => rest)
);

const isOnlyRuleEnabledChanged = (prev: NormalizedSettings, next: NormalizedSettings): boolean => {
  const prevWithoutEnabled = { ...prev, rules: stripRuleEnabled(prev.rules) };
  const nextWithoutEnabled = { ...next, rules: stripRuleEnabled(next.rules) };

  if (JSON.stringify(prevWithoutEnabled) !== JSON.stringify(nextWithoutEnabled)) {
    return false;
  }

  return JSON.stringify(prev) !== JSON.stringify(next);
};

const CustomerServiceSettingsModal = ({
  isOpen,
  chats,
  chatFullInfos,
  topicsInfoByChatId,
  users,
  chatFolders,
  orderedFolderIds,
  savedSettings,
}: StateProps) => {
  const {
    initializeCustomerServiceV2Settings,
    closeCustomerServiceV2Settings,
    saveCustomerServiceV2Settings,
    exportCustomerServiceV2Settings,
    importCustomerServiceV2Settings,
    loadTopics,
  } = getActions();

  const lang = useLang();

  const hasCloudSync = Boolean(CUSTOMER_SERVICE_CONFIG.CLOUD_SYNC_ENABLED);

  const [activeTab, setActiveTab] = useState(0);
  const [settings, setSettings] = useState<FilterSettings>(() => buildFilterSettings(savedSettings));
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false);
      setIsCloudSyncOpen(false);
      return;
    }

    if (savedSettings) {
      setSettings(buildFilterSettings(savedSettings));
      setHasInitialized(true);
      return;
    }

    if (!hasInitialized) {
      setSettings(buildFilterSettings());
      setHasInitialized(true);
    }
  }, [isOpen, savedSettings, hasInitialized]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    initializeCustomerServiceV2Settings({});
  }, [initializeCustomerServiceV2Settings, isOpen]);

  const updateSettings = useLastCallback((updater: (prev: FilterSettings) => FilterSettings) => {
    setSettings((prev) => updater(prev));
  });

  const handleMonitoredChatIdsChange = useLastCallback((nextIds: string[]) => {
    updateSettings((prev) => ({
      ...prev,
      monitoredChatIds: nextIds,
    }));
  });

  const handleFilteredUserIdsChange = useLastCallback((nextIds: string[]) => {
    updateSettings((prev) => ({
      ...prev,
      filteredUserIds: nextIds,
    }));
  });

  const handleRegexFiltersChange = useLastCallback((nextFilters: RegExp[]) => {
    updateSettings((prev) => ({
      ...prev,
      regexFilters: nextFilters,
    }));
  });

  const handleQuickRepliesChange = useLastCallback((nextQuickReplies: CustomerServiceQuickReply[]) => {
    updateSettings((prev) => ({
      ...prev,
      quickReplies: nextQuickReplies,
    }));
  });

  const handleQuickReplyPanelGlobalChange = useLastCallback((value: boolean) => {
    updateSettings((prev) => ({
      ...prev,
      quickReplyPanelGlobal: value,
    }));
  });

  const handleAutoReadChange = useLastCallback((isChecked: boolean) => {
    updateSettings((prev) => ({
      ...prev,
      autoRead: isChecked,
    }));
  });

  const handleRulesChange = useLastCallback((nextRules: UserRule[]) => {
    updateSettings((prev) => ({
      ...prev,
      rules: nextRules,
    }));
  });

  const handleOncallChange = useLastCallback((nextOncall: CustomerServiceOncallSettings) => {
    updateSettings((prev) => ({
      ...prev,
      oncall: normalizeCustomerServiceOncallSettings(nextOncall),
    }));
  });

  const handleClose = useLastCallback(() => {
    setActiveTab(0);
    setHasInitialized(false);
    closeCustomerServiceV2Settings({});
  });

  const handleSave = useLastCallback(() => {
    const normalizedSettings = buildNormalizedSettings(settings, chats);
    const previousNormalized = buildNormalizedSavedSettings(savedSettings);
    const skipCloudSync = previousNormalized
      ? isOnlyRuleEnabledChanged(previousNormalized, normalizedSettings)
      : false;

    saveCustomerServiceV2Settings({ settings: normalizedSettings, skipCloudSync });
    handleClose();
  });

  const handleReset = useLastCallback(() => {
    setSettings(buildFilterSettings());
  });

  const handleExportSettings = useLastCallback(() => {
    exportCustomerServiceV2Settings({});
  });

  const handleImportSettings = useLastCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const fileContent = e.target?.result as string;
        if (fileContent) {
          importCustomerServiceV2Settings({ fileContent });
          setHasInitialized(false);
        }
      };
      reader.readAsText(file, 'utf-8');
    };

    input.click();
  });

  const tabs = useMemo(() => ([
    { title: lang('CustomerServiceGroupFilters') },
    { title: lang('CustomerServiceUserFilters') },
    { title: lang('CustomerServiceMessageFilters') },
    { title: lang('CustomerServiceQuickReplies') },
    { title: lang('CustomerServiceRuleEngine') },
    { title: lang('CustomerServiceOncallGuarantee') },
  ]), [lang]);

  if (!isOpen) {
    return undefined;
  }

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={handleClose}
        className={styles.modal}
        headerClassName={styles.header}
        header={(
          <div className={styles.titleRow}>
            <Icon name="settings" className={styles.titleIcon} />
            <TabList
              tabs={tabs}
              activeTab={activeTab}
              onSwitchTab={setActiveTab}
              className={styles.tabs}
            />
          </div>
        )}
      >
        <div className={styles.settingsModal}>
          <div className={styles.content}>
            {activeTab === 0 && (
              <GroupFiltersTab
                chats={chats}
                chatFullInfos={chatFullInfos}
                chatFolders={chatFolders}
                orderedFolderIds={orderedFolderIds}
                monitoredChatIds={settings.monitoredChatIds}
                knownChats={settings.knownChats}
                onChange={handleMonitoredChatIdsChange}
              />
            )}
            {activeTab === 1 && (
              <UserFiltersTab
                users={users}
                chats={chats}
                filteredUserIds={settings.filteredUserIds}
                onChange={handleFilteredUserIdsChange}
              />
            )}
            {activeTab === 2 && (
              <MessageFiltersTab
                regexFilters={settings.regexFilters}
                onChange={handleRegexFiltersChange}
              />
            )}
            {activeTab === 3 && (
              <QuickRepliesTab
                quickReplies={settings.quickReplies}
                quickReplyPanelGlobal={settings.quickReplyPanelGlobal}
                onQuickRepliesChange={handleQuickRepliesChange}
                onToggleGlobal={handleQuickReplyPanelGlobalChange}
              />
            )}
            {activeTab === 4 && (
              <RuleEngineTab
                rules={settings.rules}
                onRulesChange={handleRulesChange}
              />
            )}
            {activeTab === 5 && (
              <OncallGuaranteeTab
                oncall={settings.oncall}
                users={users}
                chats={chats}
                knownChats={settings.knownChats}
                topicsInfoByChatId={topicsInfoByChatId}
                onLoadTopics={loadTopics}
                onChange={handleOncallChange}
              />
            )}
          </div>

          <div className={styles.footer}>
            <div className={styles.leftSection}>
              <Checkbox
                label={lang('CustomerServiceAutoRead')}
                className={styles.autoReadCheckbox}
                checked={Boolean(settings.autoRead)}
                onChange={(e) => handleAutoReadChange(e.currentTarget.checked)}
              />
            </div>

            <div className={styles.rightSection}>
              <Button
                size="smaller"
                color="translucent"
                style="width: 5rem !important;"
                onClick={handleExportSettings}
                ariaLabel={lang('CustomerServiceExportDescription')}
              >
                <Icon name="download" />
                导出
              </Button>
              <Button
                size="smaller"
                color="translucent"
                style="width: 5rem !important;"
                onClick={handleImportSettings}
                ariaLabel={lang('CustomerServiceImportDescription')}
              >
                <Icon name="open-in-new-tab" />
                导入
              </Button>
              {hasCloudSync && (
                <Button
                  size="smaller"
                  color="translucent"
                  style="width: 5rem !important;"
                  onClick={() => setIsCloudSyncOpen(true)}
                  ariaLabel="云端同步"
                >
                  <Icon name="cloud-download" />
                  云端
                </Button>
              )}
              <Button
                size="smaller"
                color="translucent"
                style="width: 5rem !important;"
                onClick={handleReset}
                ariaLabel={lang('CustomerServiceResetSettings')}
              >
                <Icon name="reload" />
                重置
              </Button>
              <Button
                size="smaller"
                color="translucent"
                style="width: 5rem !important;"
                onClick={handleClose}
              >
                <Icon name="close" />
                取消
              </Button>
              <Button
                size="smaller"
                color="primary"
                style="width: 5rem !important;"
                onClick={handleSave}
              >
                <Icon name="check" />
                保存
              </Button>
            </div>
          </div>
        </div>
      </Modal>
      {hasCloudSync && (
        <CustomerServiceCloudSyncModal
          isOpen={isCloudSyncOpen}
          onClose={() => setIsCloudSyncOpen(false)}
          onDownloaded={() => {
            setHasInitialized(false);
          }}
          onUploaded={() => {
            setHasInitialized(false);
          }}
        />
      )}
    </>
  );
};

export default memo(withGlobal((global): StateProps => {
  const tabId = getCurrentTabId();
  const chats = global.chats.byId;
  const chatFullInfos = global.chats.fullInfoById;
  const topicsInfoByChatId = global.chats.topicsInfoById;
  const users = global.users.byId;
  const {
    byId: chatFolders,
    orderedIds: orderedFolderIds,
  } = global.chatFolders || {};
  const savedSettings = selectCustomerServiceV2Settings(global, tabId);
  const tabState = selectTabState(global, tabId);

  return {
    isOpen: tabState.isCustomerServiceV2SettingsOpen,
    chats,
    chatFullInfos: chatFullInfos || {},
    topicsInfoByChatId: topicsInfoByChatId || {},
    users,
    chatFolders: chatFolders || {},
    orderedFolderIds,
    savedSettings,
  };
})(CustomerServiceSettingsModal));
