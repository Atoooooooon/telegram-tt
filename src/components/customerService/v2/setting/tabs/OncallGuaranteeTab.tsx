import type { FC } from '../../../../../lib/teact/teact';
import { memo } from '../../../../../lib/teact/teact';

import type { CustomerServiceOncallSettings } from '../../../../../global/types/customerServiceV2';

import useLang from '../../../../../hooks/useLang';
import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import InputText from '../../../../ui/InputText';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './OncallGuaranteeTab.module.scss';

type Props = {
  oncall?: CustomerServiceOncallSettings;
  onChange: (next: CustomerServiceOncallSettings) => void;
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

const OncallGuaranteeTab: FC<Props> = ({ oncall, onChange }) => {
  const lang = useLang();
  const config = oncall || {};

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
          <span>{lang('CustomerServiceOncallSectionTarget')}</span>
        </div>
        <div className={styles.formGrid}>
          <InputText
            value={config.telegramAlertChatId || ''}
            onChange={(e) => updateField('telegramAlertChatId', e.currentTarget.value)}
            label={lang('CustomerServiceOncallAlertChatId')}
            placeholder={lang('CustomerServiceOncallAlertChatPlaceholder')}
            className={styles.textField}
          />
          <InputText
            value={config.telegramAlertThreadId || ''}
            onChange={(e) => updateField('telegramAlertThreadId', e.currentTarget.value)}
            label={lang('CustomerServiceOncallAlertThreadId')}
            placeholder={lang('CustomerServiceOncallOptionalPlaceholder')}
            className={styles.textField}
          />
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
