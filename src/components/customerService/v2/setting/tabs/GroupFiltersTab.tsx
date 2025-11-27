import type { ChangeEvent, FC } from '../../../../../lib/teact/teact';
import {
  memo, useEffect, useMemo, useState,
} from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';

import buildClassName from '../../../../../util/buildClassName';
import { getChatFolderIds } from '../../../../../util/folderManager';

import useLang from '../../../../../hooks/useLang';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import Checkbox from '../../../../ui/Checkbox';
import InputText from '../../../../ui/InputText';

import styles from '../CustomerServiceSettingsModal.module.scss';

type Props = {
  chats: Record<string, ApiChat>;
  chatFolders: Record<number, any>;
  orderedFolderIds?: number[];
  monitoredChatIds: string[];
  onChange: (next: string[]) => void;
};

const DEFAULT_TAG_OPTION = '-1';

const GroupFiltersTab: FC<Props> = ({
  chats,
  chatFolders,
  orderedFolderIds,
  monitoredChatIds,
  onChange,
}) => {
  const lang = useLang();

  const [selectedTagId, setSelectedTagId] = useState<string>(DEFAULT_TAG_OPTION);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [isAllSelected, setIsAllSelected] = useState(false);

  const safeChats = chats || {};
  const safeChatFolders = chatFolders || {};
  const safeMonitoredChatIds = monitoredChatIds || [];

  const allGroupChats = useMemo(() => {
    return Object.values(safeChats).filter((chat) =>
      chat
      && (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup')
      && !chat.isNotJoined,
    );
  }, [safeChats]);

  const tagOptions = useMemo(() => {
    const options = [{
      value: DEFAULT_TAG_OPTION,
      text: lang('CustomerServiceAllTags'),
    }];

    if (!orderedFolderIds?.length) {
      return options;
    }

    orderedFolderIds.forEach((folderId) => {
      if (folderId === -1) {
        return;
      }

      const folder = safeChatFolders[folderId];
      if (folder?.title?.text) {
        options.push({
          value: String(folderId),
          text: folder.title.text,
        });
      }
    });

    return options;
  }, [safeChatFolders, orderedFolderIds, lang]);

  const { filteredChats: groupChats, hasRegexError } = useMemo(() => {
    let filtered = allGroupChats;
    let regexError = false;

    if (selectedTagId !== DEFAULT_TAG_OPTION) {
      const folderId = Number(selectedTagId);
      filtered = filtered.filter((chat) => {
        const folderIds = getChatFolderIds(chat.id);
        return folderIds?.includes(folderId);
      });
    }

    if (groupSearchQuery.trim()) {
      const query = groupSearchQuery.trim();

      try {
        const regex = new RegExp(query, 'i');
        filtered = filtered.filter((chat) => regex.test(chat.title || ''));
      } catch (error) {
        const lower = query.toLowerCase();
        filtered = filtered.filter((chat) =>
          chat.title?.toLowerCase().includes(lower) || chat.id.includes(query),
        );
        regexError = true;
      }
    }

    return {
      filteredChats: filtered,
      hasRegexError: regexError,
    };
  }, [allGroupChats, groupSearchQuery, selectedTagId]);

  useEffect(() => {
    if (!groupChats.length) {
      setIsAllSelected(false);
      return;
    }

    const allGroupIds = groupChats.map((chat) => chat.id);
    const selectedCount = safeMonitoredChatIds.filter((id) => allGroupIds.includes(id)).length;
    setIsAllSelected(selectedCount === allGroupIds.length);
  }, [groupChats, safeMonitoredChatIds]);

  const handleGroupSearchChange = (e: ChangeEvent<HTMLInputElement>) => {
    setGroupSearchQuery(e.currentTarget.value);
  };

const handleClearGroupSearch = () => {
  setGroupSearchQuery('');
};

  const handleChatToggle = (chatId: string, isChecked: boolean) => {
    if (isChecked) {
      if (!safeMonitoredChatIds.includes(chatId)) {
        onChange([...safeMonitoredChatIds, chatId]);
      }
      return;
    }

    onChange(safeMonitoredChatIds.filter((id) => id !== chatId));
  };

  const handleSelectAll = () => {
    const allGroupIds = groupChats.map((chat) => chat.id);

    if (!allGroupIds.length) {
      onChange(safeMonitoredChatIds);
      return;
    }

    if (isAllSelected) {
      onChange(safeMonitoredChatIds.filter((id) => !allGroupIds.includes(id)));
    } else {
      const merged = new Set([...safeMonitoredChatIds, ...allGroupIds]);
      onChange(Array.from(merged));
    }
  };

  const getChatTagsName = (chat: ApiChat) => {
    const folderIds = getChatFolderIds(chat.id);
    if (!folderIds?.length) {
      return undefined;
    }

    const names = folderIds
      .map((folderId) => safeChatFolders[folderId]?.title?.text)
      .filter(Boolean);

    return names.length ? names.join(', ') : undefined;
  };

  const searchError = hasRegexError ? lang('CustomerServiceInvalidRegex') : '';

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h3>
          <Icon name="folder" className={styles.sectionIcon} />
          {lang('CustomerServiceSelectGroups')}
        </h3>
        <p className={styles.sectionDescription}>
          {lang('CustomerServiceSelectGroupsDescription')}
        </p>
      </div>

      <div className={styles.filterControls}>
        <div className={styles.tagFilter}>
          <Icon name="tag" className={styles.fieldIcon} />
          <label>
            {lang('CustomerServiceFilterByTag')}
            :
          </label>
          <select
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.currentTarget.value)}
          >
            {tagOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.groupSearchSection}>
          <Icon name="search" className={styles.fieldIcon} />
          <InputText
            value={groupSearchQuery}
            onChange={handleGroupSearchChange}
            placeholder={lang('CustomerServiceSearchGroups')}
            className={buildClassName(styles.searchInput, searchError && styles.error)}
          />
          {groupSearchQuery && (
            <button
              type="button"
              className={styles.clearSearchButton}
              onClick={handleClearGroupSearch}
              aria-label={lang('Clear')}
            >
              <Icon name="close" />
            </button>
          )}
        </div>

        <div className={styles.selectAllWrapper}>
          <Button
            size="tiny"
            color={isAllSelected ? 'translucent' : 'primary'}
            onClick={handleSelectAll}
            className={styles.selectAllButton}
          >
            <Icon name={isAllSelected ? 'close' : 'check'} />
            {isAllSelected ? lang('CustomerServiceDeselectAll') : lang('CustomerServiceSelectAll')}
          </Button>
        </div>
      </div>

      {searchError && (
        <div className={styles.searchError}>
          <Icon name="warning" className={styles.errorIcon} />
          {searchError}
        </div>
      )}

      <div className={styles.groupList}>
        {groupChats.length > 0 ? (
          groupChats.map((chat) => {
            const isChecked = safeMonitoredChatIds.includes(chat.id);
            const tagNames = getChatTagsName(chat);

            return (
              <div
                key={chat.id}
                className={buildClassName(styles.groupItem, isChecked && styles.selected)}
              >
                <Checkbox
                  checked={isChecked}
                  onChange={(e) => handleChatToggle(chat.id, e.currentTarget.checked)}
                  className={styles.groupCheckbox}
                />
                <div className={styles.groupInfo}>
                  <div className={styles.groupTitle}>
                    <Icon name="group" className={styles.groupIcon} />
                    {chat.title}
                  </div>
                  <div className={styles.groupMeta}>
                    <span className={styles.groupId}>
                      <Icon name="key" className={styles.metaIcon} />
                      {chat.id}
                    </span>
                    {tagNames && (
                      <span className={styles.groupFolder}>
                        {tagNames}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className={styles.emptyState}>
            <Icon name="folder" className={styles.emptyIcon} />
            <p>{lang('CustomerServiceNoGroups')}</p>
          </div>
        )}
      </div>

      <div className={styles.selectedCount}>
        <Icon name="check" className={styles.countIcon} />
        <strong>{safeMonitoredChatIds.length}</strong>
        {' '}
        {lang('CustomerServiceGroupsSelected')}
      </div>
    </div>
  );
};

export default memo(GroupFiltersTab);
