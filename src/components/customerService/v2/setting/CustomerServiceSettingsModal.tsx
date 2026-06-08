import { memo, useEffect, useMemo, useState } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiChat, ApiChatFullInfo, ApiUser } from '../../../../api/types';
import type {
  CustomerServiceCapabilityExecutionPolicies,
  CustomerServiceCasePlaybook,
  CustomerServiceExternalSettings,
  CustomerServiceOncallSettings,
  CustomerServiceQuickReply,
  CustomerServiceSettings,
  UserRule,
} from '../../../../global/types/customerServiceV2';
import type { TopicsInfo } from '../../../../types';

import { CUSTOMER_SERVICE_CONFIG } from '../../../../config/customerService';
import {
  normalizeCapabilityExecutionPolicies,
  normalizeCustomerServiceCasePlaybooks,
  normalizeCustomerServiceExternalSettings,
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
import ExternalServicesTab from './tabs/ExternalServicesTab';
import GroupFiltersTab from './tabs/GroupFiltersTab';
import MessageFiltersTab from './tabs/MessageFiltersTab';
import OncallGuaranteeTab from './tabs/OncallGuaranteeTab';
import QuickRepliesTab from './tabs/QuickRepliesTab';
import RuleEngineTab from './tabs/RuleEngineTab';
import UserFiltersTab from './tabs/UserFiltersTab';

import styles from './CustomerServiceSettingsModal.module.scss';

type StateProps = {
  isOpen?: boolean;
  currentUserId?: string;
  chats: Record<string, ApiChat>;
  chatFullInfos: Record<string, ApiChatFullInfo>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  users: Record<string, ApiUser>;
  chatFolders: Record<number, any>;
  orderedFolderIds?: number[];
  savedSettings?: CustomerServiceSettings;
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
  casePlaybooks: CustomerServiceCasePlaybook[];
  capabilityExecutionPolicies: CustomerServiceCapabilityExecutionPolicies;
  oncall: CustomerServiceOncallSettings;
  external: CustomerServiceExternalSettings;
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
  casePlaybooks: CustomerServiceCasePlaybook[];
  capabilityExecutionPolicies: CustomerServiceCapabilityExecutionPolicies;
  oncall: CustomerServiceOncallSettings;
  external: CustomerServiceExternalSettings;
};

function ensureCurrentUserInStaffIds(staffIds: string[] | undefined, currentUserId?: string) {
  const normalized = Array.isArray(staffIds)
    ? staffIds.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!currentUserId) {
    return normalized;
  }

  return [currentUserId, ...normalized.filter((item) => item !== currentUserId)];
}

function ensureOncallStaffIncludesCurrentUser(
  oncall: CustomerServiceOncallSettings,
  currentUserId?: string,
): CustomerServiceOncallSettings {
  return {
    ...oncall,
    staffIds: ensureCurrentUserInStaffIds(oncall.staffIds, currentUserId),
  };
}

const buildFilterSettings = (saved?: SavedSettings, currentUserId?: string): FilterSettings => ({
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
  casePlaybooks: normalizeCustomerServiceCasePlaybooks(saved?.casePlaybooks)
    .map((playbook) => JSON.parse(JSON.stringify(playbook))) as CustomerServiceCasePlaybook[],
  capabilityExecutionPolicies: normalizeCapabilityExecutionPolicies(saved?.capabilityExecutionPolicies),
  oncall: ensureOncallStaffIncludesCurrentUser(
    normalizeCustomerServiceOncallSettings(saved?.oncall),
    currentUserId,
  ),
  external: normalizeCustomerServiceExternalSettings(saved?.external),
});

const buildNormalizedSettings = (settings: FilterSettings, currentUserId?: string): NormalizedSettings => ({
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
  casePlaybooks: normalizeCustomerServiceCasePlaybooks(settings.casePlaybooks)
    .map((playbook) => JSON.parse(JSON.stringify(playbook))) as CustomerServiceCasePlaybook[],
  capabilityExecutionPolicies: normalizeCapabilityExecutionPolicies(settings.capabilityExecutionPolicies),
  oncall: ensureOncallStaffIncludesCurrentUser(
    normalizeCustomerServiceOncallSettings(settings.oncall),
    currentUserId,
  ),
  external: normalizeCustomerServiceExternalSettings(settings.external),
});

const CustomerServiceSettingsModal = ({
  isOpen,
  currentUserId,
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
  const [settings, setSettings] = useState<FilterSettings>(() => buildFilterSettings(savedSettings, currentUserId));
  const [hasInitialized, setHasInitialized] = useState(false);
  const [isCloudSyncOpen, setIsCloudSyncOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false);
      setIsCloudSyncOpen(false);
      return;
    }

    if (hasInitialized) {
      return;
    }

    if (savedSettings) {
      setSettings(buildFilterSettings(savedSettings, currentUserId));
    } else {
      setSettings(buildFilterSettings(undefined, currentUserId));
    }
    setHasInitialized(true);
  }, [currentUserId, hasInitialized, isOpen, savedSettings]);

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

  const handleCasePlaybooksChange = useLastCallback((nextPlaybooks: CustomerServiceCasePlaybook[]) => {
    updateSettings((prev) => ({
      ...prev,
      casePlaybooks: normalizeCustomerServiceCasePlaybooks(nextPlaybooks),
    }));
  });

  const handleOncallChange = useLastCallback((nextOncall: CustomerServiceOncallSettings) => {
    updateSettings((prev) => ({
      ...prev,
      oncall: ensureOncallStaffIncludesCurrentUser(
        normalizeCustomerServiceOncallSettings(nextOncall),
        currentUserId,
      ),
    }));
  });

  const handleExternalChange = useLastCallback((nextExternal: CustomerServiceExternalSettings) => {
    updateSettings((prev) => ({
      ...prev,
      external: normalizeCustomerServiceExternalSettings(nextExternal),
    }));
  });

  const handleClose = useLastCallback(() => {
    setActiveTab(0);
    setHasInitialized(false);
    closeCustomerServiceV2Settings({});
  });

  const handleSave = useLastCallback(() => {
    const normalizedSettings = buildNormalizedSettings(settings, currentUserId);
    saveCustomerServiceV2Settings({ settings: normalizedSettings });
    handleClose();
  });

  const handleReset = useLastCallback(() => {
    setSettings(buildFilterSettings(undefined, currentUserId));
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
    { title: '外部配置' },
    { title: '自动化' },
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
              <ExternalServicesTab
                external={settings.external}
                onChange={handleExternalChange}
              />
            )}
            {activeTab === 5 && (
              <RuleEngineTab
                rules={settings.rules}
                casePlaybooks={settings.casePlaybooks}
                oncall={settings.oncall}
                chats={chats}
                topicsInfoByChatId={topicsInfoByChatId}
                onLoadTopics={loadTopics}
                onRulesChange={handleRulesChange}
                onCasePlaybooksChange={handleCasePlaybooksChange}
                onOncallChange={handleOncallChange}
              />
            )}
            {activeTab === 6 && (
              <OncallGuaranteeTab
                oncall={settings.oncall}
                currentUserId={currentUserId}
                users={users}
                chats={chats}
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
                className={styles.footerButton}
                onClick={handleExportSettings}
                ariaLabel={lang('CustomerServiceExportDescription')}
              >
                <Icon name="download" />
                {lang('CustomerServiceExportSettings')}
              </Button>
              <Button
                size="smaller"
                color="translucent"
                className={styles.footerButton}
                onClick={handleImportSettings}
                ariaLabel={lang('CustomerServiceImportDescription')}
              >
                <Icon name="open-in-new-tab" />
                {lang('CustomerServiceImportSettings')}
              </Button>
              {hasCloudSync && (
                <Button
                  size="smaller"
                  color="translucent"
                  className={styles.footerButton}
                  onClick={() => setIsCloudSyncOpen(true)}
                  ariaLabel={lang('CustomerServiceCloudSyncButton')}
                >
                  <Icon name="cloud-download" />
                  {lang('CustomerServiceCloudSyncButton')}
                </Button>
              )}
              <Button
                size="smaller"
                color="translucent"
                className={styles.footerButton}
                onClick={handleReset}
                ariaLabel={lang('CustomerServiceResetSettings')}
              >
                <Icon name="reload" />
                {lang('CustomerServiceResetSettings')}
              </Button>
              <Button
                size="smaller"
                color="translucent"
                className={styles.footerButton}
                onClick={handleClose}
              >
                <Icon name="close" />
                {lang('CustomerServiceCancel')}
              </Button>
              <Button
                size="smaller"
                color="primary"
                className={styles.footerButton}
                onClick={handleSave}
              >
                <Icon name="check" />
                {lang('CustomerServiceSaveSettings')}
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
  const savedSettings = selectCustomerServiceV2Settings(global);
  const tabState = selectTabState(global, tabId);

  return {
    isOpen: tabState.isCustomerServiceV2SettingsOpen,
    currentUserId: global.currentUserId ? String(global.currentUserId) : undefined,
    chats,
    chatFullInfos: chatFullInfos || {},
    topicsInfoByChatId: topicsInfoByChatId || {},
    users,
    chatFolders: chatFolders || {},
    orderedFolderIds,
    savedSettings,
  };
})(CustomerServiceSettingsModal));
