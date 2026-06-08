import type { FC } from '../../../../../lib/teact/teact';
import type React from '../../../../../lib/teact/teact';
import {
  memo, useEffect, useMemo, useState,
} from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';
import type { TopicsInfo } from '../../../../../types';

import buildClassName from '../../../../../util/buildClassName';

import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';

import styles from './ChatTopicPicker.module.scss';

type ChatTopicValue = {
  chatId?: string;
  threadId?: string;
};

type Props = {
  chats: Record<string, ApiChat>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  value: ChatTopicValue;
  chatLabel: string;
  topicLabel: string;
  disabledLabel: string;
  topicDisabledLabel: string;
  clearDescription?: string;
  searchPlaceholder?: string;
  compact?: boolean;
  className?: string;
  onLoadTopics: (payload: { chatId: string; force?: boolean }) => void;
  onChange: (next: ChatTopicValue) => void;
};

function isSelectableChat(chat: ApiChat) {
  return !chat.isForbidden
    && !chat.isRestricted
    && !chat.isNotJoined
    && !chat.migratedTo
    && (
      chat.type === 'chatTypeBasicGroup'
      || chat.type === 'chatTypeSuperGroup'
      || chat.type === 'chatTypeChannel'
    );
}

function getChatLabel(chat?: ApiChat) {
  if (!chat) {
    return '';
  }

  return chat.title || chat.id;
}

const ChatTopicPicker: FC<Props> = ({
  chats,
  topicsInfoByChatId,
  value,
  chatLabel,
  topicLabel,
  disabledLabel,
  topicDisabledLabel,
  clearDescription = '清空当前目标',
  searchPlaceholder = '搜索群组或频道',
  compact,
  className,
  onLoadTopics,
  onChange,
}) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const selectedChat = value.chatId ? chats[value.chatId] : undefined;
  const topicsById = value.chatId ? topicsInfoByChatId[value.chatId]?.topicsById : undefined;
  const topicOptions = useMemo(() => (
    topicsById
      ? Object.values(topicsById).sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
      : []
  ), [topicsById]);

  useEffect(() => {
    if (selectedChat?.isForum && value.chatId && !topicsInfoByChatId[value.chatId]) {
      onLoadTopics({ chatId: value.chatId });
    }
  }, [onLoadTopics, selectedChat?.isForum, topicsInfoByChatId, value.chatId]);

  const chatOptions = useMemo(() => {
    const normalizedQuery = chatQuery.trim().toLowerCase();
    return Object.values(chats)
      .filter((chat) => chat && isSelectableChat(chat))
      .filter((chat) => {
        if (!normalizedQuery) {
          return true;
        }

        return getChatLabel(chat).toLowerCase().includes(normalizedQuery)
          || chat.id.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) => getChatLabel(left).localeCompare(getChatLabel(right), 'zh-CN'))
      .slice(0, 80);
  }, [chatQuery, chats]);

  const handleChatButtonClick = useLastCallback(() => {
    setIsChatOpen(true);
  });

  const handleCloseChatDropdown = useLastCallback(() => {
    setIsChatOpen(false);
    setChatQuery('');
  });

  const handleChatQueryChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setChatQuery(e.currentTarget.value);
  });

  const handleSelectChat = useLastCallback((chatId?: string) => {
    const nextChat = chatId ? chats[chatId] : undefined;
    if (chatId && nextChat?.isForum && !topicsInfoByChatId[chatId]) {
      onLoadTopics({ chatId, force: true });
    }

    onChange({
      chatId,
      threadId: undefined,
    });
    handleCloseChatDropdown();
  });

  const handleSelectTopic = useLastCallback((threadId?: string) => {
    onChange({
      chatId: value.chatId,
      threadId,
    });
  });

  const pickerClassName = buildClassName(
    styles.picker,
    compact && styles.compact,
    className,
  );

  return (
    <div className={pickerClassName}>
      <div className={styles.field}>
        <div className={styles.label}>{chatLabel}</div>
        <button
          type="button"
          className={buildClassName(styles.trigger, !selectedChat && styles.emptyTrigger)}
          onClick={handleChatButtonClick}
        >
          <Icon name={selectedChat?.isForum ? 'folder' : 'group'} className={styles.triggerIcon} />
          <span className={styles.triggerText}>
            <span className={styles.triggerTitle}>
              {selectedChat ? getChatLabel(selectedChat) : disabledLabel}
            </span>
            {selectedChat && (
              <span className={styles.triggerMeta}>
                {selectedChat.isForum ? 'Forum · ' : ''}
                {selectedChat.id}
              </span>
            )}
          </span>
          <Icon name="down" className={styles.chevron} />
        </button>

        {isChatOpen && (
          <>
            <div className={styles.overlay} onClick={handleCloseChatDropdown} />
            <div className={styles.dropdown}>
              <div className={styles.searchBox}>
                <Icon name="search" className={styles.searchIcon} />
                <input
                  value={chatQuery}
                  onChange={handleChatQueryChange}
                  placeholder={searchPlaceholder}
                  className={styles.searchInput}
                />
              </div>
              <button
                type="button"
                className={styles.option}
                onClick={() => handleSelectChat(undefined)}
              >
                <span className={styles.optionIcon}>
                  <Icon name="close" />
                </span>
                <span className={styles.optionText}>
                  <span className={styles.optionTitle}>{disabledLabel}</span>
                  <span className={styles.optionMeta}>{clearDescription}</span>
                </span>
              </button>
              <div className={styles.optionList}>
                {chatOptions.map((chat) => (
                  <button
                    type="button"
                    key={chat.id}
                    className={buildClassName(styles.option, chat.id === value.chatId && styles.selectedOption)}
                    onClick={() => handleSelectChat(chat.id)}
                  >
                    <span className={styles.optionIcon}>
                      <Icon name={chat.isForum ? 'folder' : 'group'} />
                    </span>
                    <span className={styles.optionText}>
                      <span className={styles.optionTitle}>{getChatLabel(chat)}</span>
                      <span className={styles.optionMeta}>
                        {chat.isForum ? 'Forum · ' : ''}
                        {chat.id}
                      </span>
                    </span>
                    {chat.id === value.chatId && <Icon name="check" className={styles.selectedIcon} />}
                  </button>
                ))}
              </div>
              {!chatOptions.length && (
                <div className={styles.emptyState}>没有匹配的群组或频道</div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.field}>
        <div className={styles.label}>{topicLabel}</div>
        {selectedChat?.isForum ? (
          <div className={styles.topicList}>
            <button
              type="button"
              className={buildClassName(styles.topicChip, !value.threadId && styles.selectedTopicChip)}
              onClick={() => handleSelectTopic(undefined)}
            >
              {topicDisabledLabel}
            </button>
            {topicOptions.map((topic) => (
              <button
                type="button"
                key={topic.id}
                className={buildClassName(
                  styles.topicChip,
                  String(topic.id) === value.threadId && styles.selectedTopicChip,
                )}
                onClick={() => handleSelectTopic(String(topic.id))}
              >
                {topic.title}
              </button>
            ))}
            {!topicOptions.length && (
              <span className={styles.topicHint}>正在加载话题，或该群暂无可选话题。</span>
            )}
          </div>
        ) : (
          <div className={styles.topicDisabled}>
            {selectedChat ? '所选群不支持话题' : '先选择支持话题的群'}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(ChatTopicPicker);
