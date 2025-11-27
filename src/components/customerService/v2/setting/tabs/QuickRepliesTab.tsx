import type { FC } from '../../../../../lib/teact/teact';
import { memo, useState } from '../../../../../lib/teact/teact';

import type { CustomerServiceQuickReply } from '../../../../../global/types/customerServiceV2';

import buildClassName from '../../../../../util/buildClassName';

import useLang from '../../../../../hooks/useLang';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';

import styles from '../CustomerServiceSettingsModal.module.scss';

type Props = {
  quickReplies: CustomerServiceQuickReply[];
  quickReplyPanelGlobal: boolean;
  onQuickRepliesChange: (next: CustomerServiceQuickReply[]) => void;
  onToggleGlobal: (value: boolean) => void;
};

const QuickRepliesTab: FC<Props> = ({
  quickReplies,
  quickReplyPanelGlobal,
  onQuickRepliesChange,
  onToggleGlobal,
}) => {
  const lang = useLang();
  const [newQuickReply, setNewQuickReply] = useState('');

  const safeQuickReplies = quickReplies || [];

  const handleQuickReplyChange = (index: number, value: string) => {
    onQuickRepliesChange(
      safeQuickReplies.map((reply, i) => (i === index ? { ...reply, text: value } : reply)),
    );
  };

  const handleQuickReplyModeChange = (index: number) => {
    onQuickRepliesChange(
      safeQuickReplies.map((reply, i) => (i === index
        ? { ...reply, mode: reply.mode === 'send' ? 'insert' : 'send' }
        : reply)),
    );
  };

  const handleRemoveQuickReply = (index: number) => {
    onQuickRepliesChange(safeQuickReplies.filter((_, i) => i !== index));
  };

  const handleAddQuickReply = () => {
    const trimmed = newQuickReply.trim();
    if (!trimmed) {
      return;
    }

    onQuickRepliesChange([
      ...safeQuickReplies,
      { text: trimmed, mode: 'send' },
    ]);

    setNewQuickReply('');
  };

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h3>
          <Icon name="send" className={styles.sectionIcon} />
          {lang('CustomerServiceQuickReplies')}
        </h3>
        <p className={styles.sectionDescription}>
          {lang('CustomerServiceQuickRepliesDescription')}
        </p>
      </div>

      <div className={styles.quickReplyToggleRow}>
        <div className={styles.quickReplyToggleHint}>
          {lang('CustomerServiceQuickReplyPanelHint')}
        </div>
        <Switcher
          checked={quickReplyPanelGlobal}
          onCheck={onToggleGlobal}
        />
      </div>
        <div className={styles.addSection}>
        <div className={styles.quickReplyCreator}>
          <InputText
            value={newQuickReply}
            onChange={(e) => setNewQuickReply(e.currentTarget.value)}
            placeholder={lang('CustomerServiceQuickReplyPlaceholder')}
            className={styles.quickReplyAddInput}
          />
          <div className={styles.addReplyWrapper}>
            <Button
              size="smaller"
              color="primary"
              onClick={handleAddQuickReply}
              disabled={!newQuickReply.trim()}
              className={styles.quickReplyAddButton}
            >
              <Icon name="add" />
              {lang('CustomerServiceAddQuickReply')}
            </Button>
          </div>
        </div>
      </div>

      {safeQuickReplies.length > 0 ? (
        <div className={styles.quickReplyList}>
          {safeQuickReplies.map((reply, index) => (
            <div
              key={`quick-reply-${index}`}
              className={styles.quickReplyItem}
              data-mode={reply.mode}
            >
              <div className={styles.quickReplyTextWrapper}>
                <InputText
                  value={reply.text}
                  onChange={(e) => handleQuickReplyChange(index, e.currentTarget.value)}
                  className={styles.quickReplyTextInput}
                  placeholder={lang('CustomerServiceQuickReplyPlaceholder')}
                />
              </div>
              <div className={styles.quickReplyActions}>
                <Button
                  size="tiny"
                  color="translucent"
                  className={buildClassName(
                    styles.quickReplyModeButton,
                    reply.mode === 'send'
                      ? styles.quickReplyModeSend
                      : styles.quickReplyModeInsert,
                  )}
                  onClick={() => handleQuickReplyModeChange(index)}
                  ariaLabel={lang(
                    reply.mode === 'send'
                      ? 'CustomerServiceQuickReplyModeSend'
                      : 'CustomerServiceQuickReplyModeInsert',
                  )}
                >
                  <Icon name={reply.mode === 'send' ? 'send' : 'edit'} />
                </Button>
                <Button
                  size="tiny"
                  color="translucent"
                  round
                  className={styles.quickReplyRemoveButton}
                  onClick={() => handleRemoveQuickReply(index)}
                  ariaLabel={lang('CustomerServiceDeleteQuickReply')}
                >
                  <Icon name="close" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.quickReplyEmpty}>
          <Icon name="animals" className={styles.quickReplyEmptyIcon} />
          <span>{lang('CustomerServiceNoQuickReplies')}</span>
        </div>
      )}
    </div>
  );
};

export default memo(QuickRepliesTab);
