import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import {
  memo, useEffect, useMemo, useState,
} from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';
import type {
  CustomerServiceKnownChat,
  CustomerServiceOncallSettings,
} from '../../../../../global/types/customerServiceV2';
import type { TopicsInfo } from '../../../../../types';

import { buildCustomerServiceChatOptions } from '../../../../../global/helpers/customerServiceV2Settings';

import useLang from '../../../../../hooks/useLang';
import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';
import Select from '../../../../ui/Select';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './OncallGuaranteeTab.module.scss';

type Props = {
  oncall?: CustomerServiceOncallSettings;
  users: Record<string, any>;
  chats: Record<string, ApiChat>;
  knownChats?: Record<string, CustomerServiceKnownChat>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  onLoadTopics: (payload: { chatId: string; force?: boolean }) => void;
  onChange: (next: CustomerServiceOncallSettings) => void;
};

type AlertStage = 'new' | 'holding' | 'highest' | 'resolved';

type StageOption = {
  stage: AlertStage;
  chatKey: 'newAlertChatId' | 'holdingAlertChatId' | 'highestAlertChatId' | 'resolvedAlertChatId';
  threadKey: 'newAlertThreadId' | 'holdingAlertThreadId' | 'highestAlertThreadId' | 'resolvedAlertThreadId';
  label: string;
  description: string;
};

type SearchResult = {
  id: string;
  name: string;
  username?: string;
};

const EMPTY_USERS: Record<string, any> = {};
const EMPTY_KNOWN_CHATS: Record<string, CustomerServiceKnownChat> = {};

function stringifyPatterns(patterns?: string[]) {
  return (patterns || []).join('\n');
}

function parsePatterns(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

const OncallGuaranteeTab: FC<Props> = ({
  oncall,
  users,
  chats,
  knownChats,
  topicsInfoByChatId,
  onLoadTopics,
  onChange,
}) => {
  const lang = useLang();
  const config = oncall || {};
  const [staffSearchQuery, setStaffSearchQuery] = useState('');
  const [isStaffSearchOpen, setIsStaffSearchOpen] = useState(false);
  const safeUsers = users || EMPTY_USERS;
  const safeKnownChats = knownChats || EMPTY_KNOWN_CHATS;

  const stageOptions: StageOption[] = [
    {
      stage: 'new',
      chatKey: 'newAlertChatId',
      threadKey: 'newAlertThreadId',
      label: lang('CustomerServiceOncallStageNew'),
      description: lang('CustomerServiceOncallStageNewHint'),
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
  const selectedStageChatIds = useMemo(() => (
    Array.from(new Set([
      config.newAlertChatId,
      config.holdingAlertChatId,
      config.highestAlertChatId,
      config.resolvedAlertChatId,
    ].filter((chatId): chatId is string => Boolean(chatId))))
  ), [
    config.newAlertChatId,
    config.holdingAlertChatId,
    config.highestAlertChatId,
    config.resolvedAlertChatId,
  ]);
  const chatOptions = useMemo(() => {
    return buildCustomerServiceChatOptions({
      chats,
      knownChats: safeKnownChats,
      referencedChatIds: selectedStageChatIds,
    });
  }, [chats, safeKnownChats, selectedStageChatIds]);
  const chatOptionsById = useMemo(() => (
    chatOptions.reduce<Record<string, ApiChat>>((acc, chat) => {
      acc[chat.id] = chat;
      return acc;
    }, {})
  ), [chatOptions]);

  useEffect(() => {
    selectedStageChatIds.forEach((chatId) => {
      const chat = chatOptionsById[chatId];
      if (chat?.isForum && !topicsInfoByChatId[chatId]) {
        onLoadTopics({ chatId, force: true });
      }
    });
  }, [chatOptionsById, onLoadTopics, selectedStageChatIds, topicsInfoByChatId]);

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
    const nextChat = nextChatId ? chatOptionsById[nextChatId] : undefined;

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
    threadKey: StageOption['threadKey'],
  ) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateField(threadKey, e.currentTarget.value || undefined);
  });

  const staffSearchResults = useMemo(() => {
    if (!staffSearchQuery.trim()) {
      return [] as SearchResult[];
    }

    const query = staffSearchQuery.toLowerCase();

    return Object.values(safeUsers)
      .filter(Boolean)
      .filter((user) => {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        const username = user.usernames?.[0]?.username || user.username;
        const idMatch = String(user.id).toLowerCase().includes(query);
        const nameMatch = fullName.toLowerCase().includes(query);
        const usernameMatch = Boolean(username && username.toLowerCase().includes(query));

        return idMatch || nameMatch || usernameMatch;
      })
      .map((user) => {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        return {
          id: String(user.id),
          name: fullName || user.firstName || user.lastName || `User ${user.id}`,
          username: user.usernames?.[0]?.username || user.username,
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .slice(0, 10);
  }, [safeUsers, staffSearchQuery]);

  const getStaffInfo = useLastCallback((userId: string) => {
    const user = safeUsers[userId];
    if (!user) {
      return {
        title: `User ${userId}`,
        username: undefined,
      };
    }

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    return {
      title: fullName || user.firstName || user.lastName || `User ${userId}`,
      username: user.usernames?.[0]?.username || user.username,
    };
  });

  const handleStaffSearchChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setStaffSearchQuery(value);
    setIsStaffSearchOpen(Boolean(value));
  });

  const handleSelectStaff = useLastCallback((userId: string) => {
    const nextStaffIds = Array.from(new Set([...(config.staffIds || []), userId]));
    updateField('staffIds', nextStaffIds);
    setStaffSearchQuery('');
    setIsStaffSearchOpen(false);
  });

  const handleRemoveStaff = useLastCallback((userId: string) => {
    updateField('staffIds', (config.staffIds || []).filter((id) => id !== userId));
  });

  const handleCloseStaffSearch = useLastCallback(() => {
    setIsStaffSearchOpen(false);
  });

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

      <div className={styles.sectionBlock}>
        <div className={styles.sectionTitle}>
          <Icon name="lock" />
          <span>{lang('CustomerServiceOncallSectionTargets')}</span>
        </div>
        <div className={styles.stageRouteList}>
          {stageOptions.map(({ stage, chatKey, threadKey, label, description }) => {
            const selectedChatId = config[chatKey];
            const selectedThreadId = config[threadKey];
            const selectedChat = selectedChatId ? chatOptionsById[selectedChatId] : undefined;
            const topicsById = selectedChatId ? topicsInfoByChatId[selectedChatId]?.topicsById : undefined;
            const sortedTopicOptions = topicsById
              ? Object.values(topicsById).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
              : [];
            const topicOptions = selectedThreadId
              && !sortedTopicOptions.some((topic) => String(topic.id) === selectedThreadId)
              ? [{ id: selectedThreadId, title: `已配置 Topic (${selectedThreadId})` }, ...sortedTopicOptions]
              : sortedTopicOptions;
            const isTopicSelectable = Boolean(selectedChat?.isForum && topicOptions.length);

            return (
              <div key={stage} className={styles.stageRouteCard}>
                <div className={styles.stageRouteHeader}>
                  <div className={styles.stageRouteLabel}>{label}</div>
                  <div className={styles.stageRouteDescription}>{description}</div>
                </div>
                <div className={styles.stageRouteFields}>
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
          <Icon name="user" />
          <span>{lang('CustomerServiceOncallSectionStaff')}</span>
        </div>
        <div className={styles.sectionHint}>
          {lang('CustomerServiceOncallStaffHint')}
        </div>
        <div className={styles.staffSearchContainer}>
          <div className={styles.staffSearchInputWrapper}>
            <Icon name="search" className={styles.staffSearchIcon} />
            <InputText
              value={staffSearchQuery}
              onChange={handleStaffSearchChange}
              placeholder={lang('CustomerServiceSearchUsers')}
              className={styles.staffSearchInput}
            />
          </div>

          {isStaffSearchOpen && staffSearchResults.length > 0 && (
            <>
              <div className={styles.staffSearchDropdown}>
                {staffSearchResults.map((result) => (
                  <div
                    key={result.id}
                    className={styles.staffSearchResult}
                    onClick={() => handleSelectStaff(result.id)}
                  >
                    <div className={styles.staffAvatar}>
                      <Icon name="user" />
                    </div>
                    <div className={styles.staffResultInfo}>
                      <div className={styles.staffResultName}>{result.name}</div>
                      <div className={styles.staffResultMeta}>
                        <span>{result.id}</span>
                        {result.username && <span>{`@${result.username}`}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.staffSearchOverlay} onClick={handleCloseStaffSearch} />
            </>
          )}
        </div>

        {config.staffIds?.length ? (
          <div className={styles.staffList}>
            {config.staffIds.map((userId) => {
              const staffInfo = getStaffInfo(userId);

              return (
                <div key={userId} className={styles.staffItem}>
                  <div className={styles.staffMain}>
                    <div className={styles.staffAvatar}>
                      <Icon name="user" />
                    </div>
                    <div className={styles.staffInfo}>
                      <div className={styles.staffName}>{staffInfo.title}</div>
                      <div className={styles.staffMeta}>
                        <span>{userId}</span>
                        {staffInfo.username && <span>{`@${staffInfo.username}`}</span>}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="tiny"
                    color="translucent"
                    className={styles.removeStaffButton}
                    onClick={() => handleRemoveStaff(userId)}
                    ariaLabel={lang('CustomerServiceOncallRemoveStaff')}
                  >
                    <Icon name="close" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.staffEmptyState}>
            <Icon name="user" className={styles.staffEmptyIcon} />
            <p>{lang('CustomerServiceOncallNoStaff')}</p>
          </div>
        )}
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
      </div>
    </div>
  );
};

export default memo(OncallGuaranteeTab);
