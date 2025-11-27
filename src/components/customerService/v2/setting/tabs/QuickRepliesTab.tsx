import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import { memo, useCallback, useRef, useState } from '../../../../../lib/teact/teact';

import type { CustomerServiceQuickReply } from '../../../../../global/types/customerServiceV2';

import buildClassName from '../../../../../util/buildClassName';

import useLang from '../../../../../hooks/useLang';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';
import Switcher from '../../../../ui/Switcher';

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
  const [newQuickReplyEnglish, setNewQuickReplyEnglish] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | undefined>();

  const safeQuickReplies = quickReplies || [];
  const pendingQuickRepliesRef = useRef(safeQuickReplies);
  pendingQuickRepliesRef.current = safeQuickReplies;
  const dragHandleActiveRef = useRef(false);

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

  const handleQuickReplyEnglishChange = (index: number, value: string) => {
    onQuickRepliesChange(
      safeQuickReplies.map((reply, i) => (i === index
        ? { ...reply, englishText: value }
        : reply)),
    );
  };

  const handleRemoveQuickReply = (index: number) => {
    onQuickRepliesChange(safeQuickReplies.filter((_, i) => i !== index));
  };

  const handleAddQuickReply = () => {
    const trimmed = newQuickReply.trim();
    const trimmedEnglish = newQuickReplyEnglish.trim();
    if (!trimmed) {
      return;
    }

    onQuickRepliesChange([
      ...safeQuickReplies,
      {
        text: trimmed,
        englishText: trimmedEnglish || undefined,
        mode: 'send',
      },
    ]);

    setNewQuickReply('');
    setNewQuickReplyEnglish('');
  };

  const moveQuickReply = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return;
    }

    const next = pendingQuickRepliesRef.current.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    pendingQuickRepliesRef.current = next;
    onQuickRepliesChange(next);
  }, [onQuickRepliesChange]);

  const handleDragStart = useCallback((index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragHandleActiveRef.current) {
      event.preventDefault();
      return;
    }

    if (pendingQuickRepliesRef.current.length <= 1) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  }, []);

  const handleDragOver = useCallback((index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (pendingQuickRepliesRef.current.length <= 1) {
      return;
    }

    if (draggedIndex === undefined || draggedIndex === index) {
      return;
    }

    moveQuickReply(draggedIndex, index);
    setDraggedIndex(index);
  }, [draggedIndex, moveQuickReply]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(undefined);
    dragHandleActiveRef.current = false;
  }, []);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggedIndex(undefined);
    dragHandleActiveRef.current = false;
  }, []);

  const markDragHandleActive = useCallback(() => {
    dragHandleActiveRef.current = true;
  }, []);

  const clearDragHandleActive = useCallback(() => {
    dragHandleActiveRef.current = false;
  }, []);

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
          label={lang('CustomerServiceQuickReplyPanelToggle')}
          checked={quickReplyPanelGlobal}
          onCheck={onToggleGlobal}
        />
      </div>

      <div className={styles.addSection}>
        <div className={styles.quickReplyCreator}>
          <div className={styles.quickReplyAddFields}>
            <InputText
              value={newQuickReply}
              onChange={(e) => setNewQuickReply(e.currentTarget.value)}
              placeholder={lang('CustomerServiceQuickReplyPlaceholder')}
              className={styles.quickReplyAddInput}
            />
            <InputText
              value={newQuickReplyEnglish}
              onChange={(e) => setNewQuickReplyEnglish(e.currentTarget.value)}
              placeholder={lang('CustomerServiceQuickReplyEnglishPlaceholder')}
              className={styles.quickReplyAddInput}
            />
          </div>
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
              className={buildClassName(
                styles.quickReplyItem,
                draggedIndex === index && styles.quickReplyItemDragging,
              )}
              data-mode={reply.mode}
              draggable={safeQuickReplies.length > 1}
              onDragStart={handleDragStart(index)}
              onDragOver={handleDragOver(index)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              aria-grabbed={draggedIndex === index}
            >
              <div className={styles.quickReplyTextWrapper}>
                <InputText
                  value={reply.text}
                  onChange={(e) => handleQuickReplyChange(index, e.currentTarget.value)}
                  className={styles.quickReplyTextInput}
                  placeholder={lang('CustomerServiceQuickReplyPlaceholder')}
                />
                <InputText
                  value={reply.englishText || ''}
                  onChange={(e) => handleQuickReplyEnglishChange(index, e.currentTarget.value)}
                  className={styles.quickReplyTextInput}
                  placeholder={lang('CustomerServiceQuickReplyEnglishPlaceholder')}
                />
              </div>
              <div className={styles.quickReplyActions}>
                <button
                  type="button"
                  className={styles.quickReplyDragHandle}
                  aria-label={lang('i18n_dragToSort')}
                  disabled={safeQuickReplies.length <= 1}
                  onMouseDown={markDragHandleActive}
                  onTouchStart={markDragHandleActive}
                  onMouseUp={clearDragHandleActive}
                  onTouchEnd={clearDragHandleActive}
                  onTouchCancel={clearDragHandleActive}
                >
                  <Icon name="sort" />
                </button>
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
