import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import {
  memo, useEffect, useMemo, useState,
} from '../../../../../lib/teact/teact';

import type { ApiChat, ApiUser } from '../../../../../api/types';
import type { CustomerServiceOncallSettings } from '../../../../../global/types/customerServiceV2';
import type { TopicsInfo } from '../../../../../types';

import useLang from '../../../../../hooks/useLang';
import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import InputText from '../../../../ui/InputText';
import Select from '../../../../ui/Select';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './OncallGuaranteeTab.module.scss';

type Props = {
  oncall?: CustomerServiceOncallSettings;
  currentUserId?: string;
  users: Record<string, ApiUser>;
  chats: Record<string, ApiChat>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  onLoadTopics: (payload: { chatId: string; force?: boolean }) => void;
  onChange: (next: CustomerServiceOncallSettings) => void;
};

type AlertStage = 'new' | 'holding' | 'highest' | 'processing' | 'resolved';

type StageOption = {
  stage: AlertStage;
  chatKey: keyof CustomerServiceOncallSettings;
  threadKey: keyof CustomerServiceOncallSettings;
  label: string;
  description: string;
};

type UserDirectoryEntry = {
  id: string;
  name: string;
  username?: string;
};

type UserSelectorSectionProps = {
  title: string;
  description: string;
  searchQuery: string;
  isSearchOpen: boolean;
  searchResults: UserDirectoryEntry[];
  selectedEntries: UserDirectoryEntry[];
  emptyText: string;
  removeAriaLabel: string;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSearchClose: () => void;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  isRemoveDisabled?: (userId: string) => boolean;
};

function stringifyPatterns(patterns?: string[]) {
  return (patterns || []).join('\n');
}

function parsePatterns(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildUserDirectoryEntry(userId: string, users: Record<string, ApiUser>): UserDirectoryEntry {
  const user = users[userId];
  const name = user
    ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || `User ${userId}`
    : `User ${userId}`;
  const username = user?.usernames?.find((item) => item.isActive)?.username || user?.usernames?.[0]?.username;

  return {
    id: userId,
    name,
    username,
  };
}

function searchUsers(
  users: Record<string, ApiUser>,
  excludedIds: string[],
  query: string,
) {
  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    return [] as UserDirectoryEntry[];
  }

  return Object.values(users)
    .filter((user) => (
      Boolean(user)
      && user.type !== 'userTypeDeleted'
      && !excludedIds.includes(user.id)
    ))
    .map((user) => buildUserDirectoryEntry(user.id, users))
    .filter((user) => (
      user.name.toLowerCase().includes(trimmedQuery)
      || Boolean(user.username?.toLowerCase().includes(trimmedQuery))
      || user.id.toLowerCase().includes(trimmedQuery)
    ))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
    .slice(0, 10);
}

const OncallGuaranteeTab: FC<Props> = ({
  oncall,
  currentUserId,
  users,
  chats,
  topicsInfoByChatId,
  onLoadTopics,
  onChange,
}) => {
  const lang = useLang();
  const config = oncall || {};
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [isStaffSearchOpen, setIsStaffSearchOpen] = useState(false);
  const selectedStaffIds = useMemo(() => config.staffIds || [], [config.staffIds]);
  const configuredAlertChatIds = useMemo(() => (
    [
      config.newAlertChatId,
      config.processingAlertChatId,
      config.holdingAlertChatId,
      config.highestAlertChatId,
      config.resolvedAlertChatId,
    ].filter((id): id is string => Boolean(id))
  ), [
    config.highestAlertChatId,
    config.holdingAlertChatId,
    config.newAlertChatId,
    config.processingAlertChatId,
    config.resolvedAlertChatId,
  ]);

  // On mount, auto-load topics for any forum chats that are already configured
  // (onLoadTopics is normally only called when the user picks a chat, so it's
  // never triggered when the modal opens with pre-existing settings).
  useEffect(() => {
    const seen = new Set<string>();
    for (const chatId of configuredAlertChatIds) {
      if (seen.has(chatId)) continue;
      seen.add(chatId);
      const chat = chats[chatId];
      if (chat?.isForum && !topicsInfoByChatId[chatId]) {
        onLoadTopics({ chatId });
      }
    }
  }, [chats, configuredAlertChatIds, onLoadTopics, topicsInfoByChatId]);

  const chatOptions = Object.values(chats)
    .filter((chat) => (
      chat
      && !chat.isForbidden
      && !chat.isRestricted
      && (
        chat.type === 'chatTypeBasicGroup'
        || chat.type === 'chatTypeSuperGroup'
        || chat.type === 'chatTypeChannel'
      )
    ))
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));

  const staffSearchResults = useMemo(() => {
    return searchUsers(users, selectedStaffIds, staffSearchQuery);
  }, [staffSearchQuery, users, selectedStaffIds]);

  const selectedStaffEntries = useMemo(() => {
    return selectedStaffIds.map((staffId) => buildUserDirectoryEntry(staffId, users));
  }, [selectedStaffIds, users]);

  const stageOptions: StageOption[] = [
    {
      stage: 'new',
      chatKey: 'newAlertChatId',
      threadKey: 'newAlertThreadId',
      label: lang('CustomerServiceOncallStageNew'),
      description: lang('CustomerServiceOncallStageNewHint'),
    },
    {
      stage: 'processing',
      chatKey: 'processingAlertChatId',
      threadKey: 'processingAlertThreadId',
      label: lang('CustomerServiceOncallStageProcessing'),
      description: lang('CustomerServiceOncallStageProcessingHint'),
    },
    {
      stage: 'holding',
      chatKey: 'holdingAlertChatId',
      threadKey: 'holdingAlertThreadId',
      label: lang('CustomerServiceOncallStageHolding'),
      description: lang('CustomerServiceOncallStageHoldingHint'),
    },
    {
      stage: 'highest',
      chatKey: 'highestAlertChatId',
      threadKey: 'highestAlertThreadId',
      label: lang('CustomerServiceOncallStageHighest'),
      description: lang('CustomerServiceOncallStageHighestHint'),
    },
    {
      stage: 'resolved',
      chatKey: 'resolvedAlertChatId',
      threadKey: 'resolvedAlertThreadId',
      label: lang('CustomerServiceOncallStageResolved'),
      description: lang('CustomerServiceOncallStageResolvedHint'),
    },
  ];

  const updateField = useLastCallback((
    key: keyof CustomerServiceOncallSettings,
    value: CustomerServiceOncallSettings[keyof CustomerServiceOncallSettings],
  ) => {
    onChange({
      ...config,
      [key]: value,
    });
  });

  const updateNumberField = useLastCallback((
    key: 'firstResponseTimeoutMs'
      | 'highestEscalationTimeoutMs'
      | 'holdingReplyGraceTimeoutMs'
      | 'reminderCooldownMs',
    value: string,
  ) => {
    if (!value.trim()) {
      updateField(key, undefined);
      return;
    }

    const parsed = Number(value);
    updateField(key, Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
  });

  const handleChatTargetChange = useLastCallback((
    chatKey: keyof CustomerServiceOncallSettings,
    threadKey: keyof CustomerServiceOncallSettings,
  ) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextChatId = e.currentTarget.value || undefined;
    const nextChat = nextChatId ? chats[nextChatId] : undefined;

    if (nextChatId && nextChat?.isForum && !topicsInfoByChatId[nextChatId]) {
      onLoadTopics({ chatId: nextChatId, force: true });
    }

    onChange({
      ...config,
      [chatKey]: nextChatId,
      [threadKey]: undefined,
    });
  });

  const handleThreadTargetChange = useLastCallback((
    threadKey: keyof CustomerServiceOncallSettings,
  ) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateField(threadKey, e.currentTarget.value || undefined);
  });

  const handleStaffSearchChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.currentTarget.value;
    setStaffSearchQuery(nextValue);
    setIsStaffSearchOpen(Boolean(nextValue.trim()));
  });

  const handleAddStaff = useLastCallback((staffId: string) => {
    if (selectedStaffIds.includes(staffId)) {
      return;
    }

    updateField('staffIds', [...selectedStaffIds, staffId]);
    setStaffSearchQuery('');
    setIsStaffSearchOpen(false);
  });

  const handleRemoveStaff = useLastCallback((staffId: string) => {
    if (staffId === currentUserId) {
      return;
    }

    updateField('staffIds', selectedStaffIds.filter((id) => id !== staffId));
  });

  const renderUserSelectorSection = useLastCallback(({
    title,
    description,
    searchQuery,
    isSearchOpen,
    searchResults,
    selectedEntries,
    emptyText,
    removeAriaLabel,
    onSearchChange,
    onSearchClose,
    onAdd,
    onRemove,
    isRemoveDisabled,
  }: UserSelectorSectionProps) => (
    <div className={styles.sectionBlock}>
      <div className={styles.sectionTitle}>
        <Icon name="user" />
        <span>{title}</span>
      </div>
      <div className={styles.sectionDescription}>
        {description}
      </div>

      <div className={styles.searchContainer}>
        <div className={styles.staffSearchInputWrapper}>
          <Icon name="search" className={styles.inputIcon} />
          <InputText
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={lang('CustomerServiceSearchUsers')}
            className={styles.staffSearchInput}
          />
        </div>

        {isSearchOpen && searchResults.length > 0 && (
          <>
            <div className={styles.searchDropdown}>
              {searchResults.map((result) => (
                <button
                  type="button"
                  key={result.id}
                  className={styles.searchResultItem}
                  onClick={() => onAdd(result.id)}
                >
                  <div className={styles.resultAvatar}>
                    <Icon name="user" />
                  </div>
                  <div className={styles.resultInfo}>
                    <div className={styles.resultName}>{result.name}</div>
                    <div className={styles.resultDetails}>
                      <span className={styles.resultId}>{result.id}</span>
                      {result.username && (
                        <span className={styles.resultUsername}>
                          @
                          {result.username}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className={styles.searchOverlay} onClick={onSearchClose} />
          </>
        )}
      </div>

      {selectedEntries.length > 0 ? (
        <div className={styles.staffList}>
          {selectedEntries.map((entry) => {
            const isDisabled = Boolean(isRemoveDisabled?.(entry.id));

            return (
              <div key={entry.id} className={styles.staffItem}>
                <div className={styles.staffContent}>
                  <div className={styles.userAvatar}>
                    <Icon name="user" className={styles.filterIcon} />
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName}>{entry.name}</div>
                    <div className={styles.userDetails}>
                      <span className={styles.userId}>{entry.id}</span>
                      {entry.username && (
                        <span className={styles.userUsername}>
                          @
                          {entry.username}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.removeButton}
                  aria-label={removeAriaLabel}
                  disabled={isDisabled}
                  onClick={() => onRemove(entry.id)}
                >
                  <Icon name="close" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Icon name="user" className={styles.emptyIcon} />
          <p>{emptyText}</p>
        </div>
      )}
    </div>
  ));

  return (
    <div className={layoutStyles.tabContent}>
      <div className={layoutStyles.sectionHeader}>
        <h3>
          <Icon name="phone" className={layoutStyles.sectionIcon} />
          {lang('CustomerServiceOncallGuarantee')}
        </h3>
        <p className={layoutStyles.sectionDescription}>
          {lang('CustomerServiceOncallGuaranteeDescription')}
        </p>
      </div>

      <div className={styles.switcherRow}>
        <div className={styles.switcherHint}>
          {lang('CustomerServiceOncallEnableHint')}
        </div>
        <Switcher
          label={lang('CustomerServiceOncallEnabled')}
          checked={Boolean(config.enabled)}
          onCheck={(value) => updateField('enabled', value)}
        />
      </div>

      <div className={styles.summaryCard}>
        <div className={styles.summaryRow}>
          <Icon name="info" className={styles.summaryIcon} />
          <span>{lang('CustomerServiceOncallGuaranteeSummary1')}</span>
        </div>
        <div className={styles.summaryRow}>
          <Icon name="settings" className={styles.summaryIcon} />
          <span>{lang('CustomerServiceOncallGuaranteeSummary2')}</span>
        </div>
      </div>

      {renderUserSelectorSection({
        title: lang('CustomerServiceOncallStaffIds'),
        description: lang('CustomerServiceOncallStaffIdsDescription'),
        searchQuery: staffSearchQuery,
        isSearchOpen: isStaffSearchOpen,
        searchResults: staffSearchResults,
        selectedEntries: selectedStaffEntries,
        emptyText: lang('CustomerServiceOncallNoStaffUsers'),
        removeAriaLabel: lang('CustomerServiceOncallRemoveStaffUser'),
        onSearchChange: handleStaffSearchChange,
        onSearchClose: () => setIsStaffSearchOpen(false),
        onAdd: handleAddStaff,
        onRemove: handleRemoveStaff,
        isRemoveDisabled: (userId) => userId === currentUserId,
      })}

      <div className={styles.sectionBlock}>
        <div className={styles.sectionTitle}>
          <Icon name="lock" />
          <span>{lang('CustomerServiceOncallSectionTargets')}</span>
        </div>
        <div className={styles.stageRouteList}>
          {stageOptions.map(({ stage, chatKey, threadKey, label, description }) => {
            const selectedChatId = config[chatKey] as string | undefined;
            const selectedThreadId = config[threadKey] as string | undefined;
            const selectedChat = selectedChatId ? chats[selectedChatId] : undefined;
            const topicsById = selectedChatId ? topicsInfoByChatId[selectedChatId]?.topicsById : undefined;
            const topicOptions = topicsById
              ? Object.values(topicsById).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
              : [];
            const isTopicSelectable = Boolean(selectedChat?.isForum && topicOptions.length);

            return (
              <div key={stage} className={styles.stageRouteCard}>
                <div className={styles.stageRouteHeader}>
                  <div className={styles.stageRouteLabel}>{label}</div>
                  <div className={styles.stageRouteDescription}>{description}</div>
                </div>
                <div className={styles.formGrid}>
                  <Select
                    id={`oncall-stage-chat-${stage}`}
                    value={selectedChatId || ''}
                    label={lang('CustomerServiceOncallAlertGroup')}
                    hasArrow
                    onChange={handleChatTargetChange(chatKey, threadKey)}
                  >
                    <option value="">{lang('CustomerServiceOncallTargetDisabled')}</option>
                    {chatOptions.map((chat) => (
                      <option key={chat.id} value={chat.id}>
                        {chat.isForum ? `[Forum] ${chat.title}` : chat.title}
                      </option>
                    ))}
                  </Select>
                  <Select
                    id={`oncall-stage-thread-${stage}`}
                    value={selectedThreadId || ''}
                    label={lang('CustomerServiceOncallAlertTopic')}
                    hasArrow
                    onChange={handleThreadTargetChange(threadKey)}
                  >
                    <option value="">{lang('CustomerServiceOncallTopicDisabled')}</option>
                    {isTopicSelectable && topicOptions.map((topic) => (
                      <option key={topic.id} value={String(topic.id)}>
                        {topic.title}
                      </option>
                    ))}
                  </Select>
                </div>
                {selectedChat && !selectedChat.isForum && (
                  <div className={styles.stageRouteHint}>
                    {lang('CustomerServiceOncallTopicUnavailableHint')}
                  </div>
                )}
                {selectedChat?.isForum && !topicOptions.length && (
                  <div className={styles.stageRouteHint}>
                    {lang('CustomerServiceOncallTopicLoadHint')}
                  </div>
                )}
                {selectedChat?.isForum && topicOptions.length > 0 && !selectedThreadId && (
                  <div className={styles.stageRouteHint}>
                    {lang('CustomerServiceOncallTopicRequiredHint')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.sectionBlock}>
        <div className={styles.sectionTitle}>
          <Icon name="recent" />
          <span>{lang('CustomerServiceOncallSectionTimeouts')}</span>
        </div>
        <div className={styles.formGrid}>
          <InputText
            value={String(config.firstResponseTimeoutMs ?? '')}
            onChange={(e) => updateNumberField('firstResponseTimeoutMs', e.currentTarget.value)}
            label={lang('CustomerServiceOncallFirstResponseTimeout')}
            inputMode="numeric"
            className={styles.textField}
          />
          <InputText
            value={String(config.highestEscalationTimeoutMs ?? '')}
            onChange={(e) => updateNumberField('highestEscalationTimeoutMs', e.currentTarget.value)}
            label={lang('CustomerServiceOncallHighestEscalationTimeout')}
            inputMode="numeric"
            className={styles.textField}
          />
          <InputText
            value={String(config.holdingReplyGraceTimeoutMs ?? '')}
            onChange={(e) => updateNumberField('holdingReplyGraceTimeoutMs', e.currentTarget.value)}
            label={lang('CustomerServiceOncallHoldingReplyGraceTimeout')}
            inputMode="numeric"
            className={styles.textField}
          />
          <InputText
            value={String(config.reminderCooldownMs ?? '')}
            onChange={(e) => updateNumberField('reminderCooldownMs', e.currentTarget.value)}
            label={lang('CustomerServiceOncallReminderCooldown')}
            inputMode="numeric"
            className={styles.textField}
          />
        </div>
      </div>

      <div className={styles.sectionBlock}>
        <div className={styles.sectionTitle}>
          <Icon name="tag-filter" />
          <span>{lang('CustomerServiceOncallSectionPatterns')}</span>
        </div>
        <TextArea
          value={stringifyPatterns(config.holdingReplyPatterns)}
          onChange={(e) => updateField('holdingReplyPatterns', parsePatterns(e.currentTarget.value))}
          label={lang('CustomerServiceOncallHoldingRegex')}
          placeholder={lang('CustomerServiceOncallRegexPlaceholder')}
          className={styles.textAreaField}
          noReplaceNewlines
          autoResize={false}
        />
        <TextArea
          value={stringifyPatterns(config.resolveReplyPatterns)}
          onChange={(e) => updateField('resolveReplyPatterns', parsePatterns(e.currentTarget.value))}
          label={lang('CustomerServiceOncallResolveRegex')}
          placeholder={lang('CustomerServiceOncallRegexPlaceholder')}
          className={styles.textAreaField}
          noReplaceNewlines
          autoResize={false}
        />
        <TextArea
          value={stringifyPatterns(config.customerResolvePatterns)}
          onChange={(e) => updateField('customerResolvePatterns', parsePatterns(e.currentTarget.value))}
          label={lang('CustomerServiceOncallCustomerResolveRegex')}
          placeholder={lang('CustomerServiceOncallRegexPlaceholder')}
          className={styles.textAreaField}
          noReplaceNewlines
          autoResize={false}
        />
      </div>
    </div>
  );
};

export default memo(OncallGuaranteeTab);
