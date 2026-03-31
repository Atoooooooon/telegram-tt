import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import { memo } from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';
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
  chats: Record<string, ApiChat>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  onLoadTopics: (payload: { chatId: string; force?: boolean }) => void;
  onChange: (next: CustomerServiceOncallSettings) => void;
};

type AlertStage = 'new' | 'holding' | 'highest' | 'resolved';

type StageOption = {
  stage: AlertStage;
  chatKey: keyof CustomerServiceOncallSettings;
  threadKey: keyof CustomerServiceOncallSettings;
  label: string;
  description: string;
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

const OncallGuaranteeTab: FC<Props> = ({
  oncall,
  chats,
  topicsInfoByChatId,
  onLoadTopics,
  onChange,
}) => {
  const lang = useLang();
  const config = oncall || {};
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
      </div>
    </div>
  );
};

export default memo(OncallGuaranteeTab);
