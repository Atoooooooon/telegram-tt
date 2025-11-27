import type { ChangeEvent, FC } from '../../../../../lib/teact/teact';
import { memo, useMemo, useState } from '../../../../../lib/teact/teact';

import useLang from '../../../../../hooks/useLang';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';

import styles from '../CustomerServiceSettingsModal.module.scss';

type Props = {
  regexFilters: RegExp[];
  onChange: (next: RegExp[]) => void;
};

const MessageFiltersTab: FC<Props> = ({
  regexFilters,
  onChange,
}) => {
  const lang = useLang();

  const [newRegexFilter, setNewRegexFilter] = useState('');
  const [regexValidationError, setRegexValidationError] = useState('');

  const safeRegexFilters = regexFilters || [];

  const presetRegexRules = useMemo(() => ([
    { pattern: '^/\\w+', description: lang('CustomerServiceRegexExample1') },
    { pattern: '^@\\w+', description: lang('CustomerServiceRegexExample2') },
    { pattern: '^\\[系统\\]', description: lang('CustomerServiceRegexExample3') },
    { pattern: 'bot$', description: lang('CustomerServiceRegexExample4') },
  ]), [lang]);

  const handleRegexFilterChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setNewRegexFilter(value);

    if (!value.trim()) {
      setRegexValidationError('');
      return;
    }

    try {
      new RegExp(value.trim());
      setRegexValidationError('');
    } catch (error) {
      setRegexValidationError(lang('CustomerServiceInvalidRegex'));
    }
  };

  const handleAddRegexFilter = () => {
    const trimmed = newRegexFilter.trim();
    if (!trimmed || regexValidationError) {
      return;
    }

    try {
      const regex = new RegExp(trimmed);
      const isDuplicate = safeRegexFilters.some((existing) => existing.source === trimmed);
      if (isDuplicate) {
        setNewRegexFilter('');
        return;
      }

      onChange([...safeRegexFilters, regex]);
      setNewRegexFilter('');
      setRegexValidationError('');
    } catch (error) {
      setRegexValidationError(lang('CustomerServiceInvalidRegex'));
    }
  };

  const handleRemoveRegexFilter = (index: number) => {
    onChange(safeRegexFilters.filter((_, i) => i !== index));
  };

  const handleAddPresetRegex = (pattern: string) => {
    try {
      const regex = new RegExp(pattern);
      const exists = safeRegexFilters.some((existing) => existing.source === pattern);
      if (!exists) {
        onChange([...safeRegexFilters, regex]);
      }
    } catch (error) {
      // Ignore invalid presets
    }
  };

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h3>
          <Icon name="tag-filter" className={styles.sectionIcon} />
          {lang('CustomerServiceRegexFilters')}
        </h3>
        <p className={styles.sectionDescription}>
          {lang('CustomerServiceRegexFiltersDescription')}
        </p>
      </div>

      <div className={styles.addSection}>
        <div className={styles.regexAddInputWrapper}>
          <InputText
            value={newRegexFilter}
            onChange={handleRegexFilterChange}
            placeholder={lang('CustomerServiceRegexPlaceholder')}
            className={styles.regexAddInput}
            error={regexValidationError}
          />
          <div className={styles.addRexWrapper}>
            <Button
              size="smaller"
              color="primary"
              onClick={handleAddRegexFilter}
              disabled={!newRegexFilter.trim() || Boolean(regexValidationError)}
              className={styles.addButton}
            >
              <Icon name="add" />
              {lang('Add')}
            </Button>
          </div>
        </div>
        {regexValidationError && (
          <div className={styles.validationError}>
            <Icon name="warning" className={styles.errorIcon} />
            {regexValidationError}
          </div>
        )}
      </div>

      {safeRegexFilters.length > 0 ? (
        <div className={styles.regexFilterList}>
          {safeRegexFilters.map((regex, index) => {
            const presetRule = presetRegexRules.find((rule) => rule.pattern === regex.source);

            return (
              <div key={`${regex.source}-${index}`} className={styles.filterItem}>
                <div className={styles.filterContent}>
                  <Icon name="document" className={styles.filterIcon} />
                  <div className={styles.regexInfo}>
                    <code className={styles.regexText} title={regex.source}>{regex.source}</code>
                    {presetRule && (
                      <div className={styles.regexDescription}>{presetRule.description}</div>
                    )}
                  </div>
                </div>
                <div>
                  <Button
                    size="tiny"
                    color="translucent"
                    onClick={() => handleRemoveRegexFilter(index)}
                    className={styles.removeButton}
                    ariaLabel={lang('CustomerServiceRemoveRegex')}
                  >
                    <Icon name="close" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <Icon name="tag-crossed" className={styles.emptyIcon} />
          <p>{lang('CustomerServiceNoFilteredMessages')}</p>
        </div>
      )}

      <div className={styles.regexExamples}>
        <h4>
          <Icon name="info" className={styles.infoIcon} />
          {lang('CustomerServiceRegexExamples')}
          :
        </h4>
        <ul>
          {presetRegexRules.map((rule) => (
            <li key={rule.pattern}>
              <button
                type="button"
                onClick={() => handleAddPresetRegex(rule.pattern)}
                className={styles.regexExampleButton}
              >
                <code>{rule.pattern}</code>
              </button>
              {' '}
              -
              {' '}
              {rule.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default memo(MessageFiltersTab);
