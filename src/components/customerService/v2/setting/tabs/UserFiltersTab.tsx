import type React from 'react';
import type { FC } from '../../../../../lib/teact/teact';
import {
  memo, useCallback, useMemo, useState,
} from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';

import useLang from '../../../../../hooks/useLang';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import InputText from '../../../../ui/InputText';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './UserFiltersTab.module.scss';

type SearchResult = {
  id: string;
  name: string;
  username?: string;
  type: 'user' | 'chat';
};

type Props = {
  users: Record<string, any>;
  chats: Record<string, ApiChat>;
  filteredUserIds: string[];
  onChange: (next: string[]) => void;
};

const EMPTY_USERS: Record<string, any> = {};
const EMPTY_CHATS: Record<string, ApiChat> = {};
const EMPTY_FILTERED_USER_IDS: string[] = [];

const UserFiltersTab: FC<Props> = ({
  users,
  chats,
  filteredUserIds,
  onChange,
}) => {
  const lang = useLang();

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  const safeUsers = users || EMPTY_USERS;
  const safeChats = chats || EMPTY_CHATS;
  const safeFilteredUserIds = filteredUserIds || EMPTY_FILTERED_USER_IDS;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return [] as SearchResult[];
    }

    const query = searchQuery.toLowerCase();
    const results = new Map<string, SearchResult>();
    const addResult = (result: SearchResult) => {
      const existing = results.get(result.id);
      if (!existing || (existing.type === 'chat' && result.type === 'user')) {
        results.set(result.id, result);
      }
    };

    Object.values(safeUsers).forEach((user) => {
      if (!user) return;

      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const username = user.usernames?.[0]?.username || user.username;

      const nameMatch = fullName.toLowerCase().includes(query);
      const usernameMatch = username && username.toLowerCase().includes(query);
      const idMatch = user.id.includes(query);

      if (nameMatch || usernameMatch || idMatch) {
        addResult({
          id: user.id,
          name: fullName || user.firstName || user.lastName || `User ${user.id}`,
          username,
          type: 'user',
        });
      }
    });

    Object.values(safeChats).forEach((chat) => {
      if (!chat || !chat.title) return;

      const normalizedUsername = chat.usernames?.[0]?.username;
      const titleMatch = chat.title.toLowerCase().includes(query);
      const usernameMatch = normalizedUsername && normalizedUsername.toLowerCase().includes(query);
      const idMatch = chat.id.includes(query);

      if (titleMatch || usernameMatch || idMatch) {
        addResult({
          id: chat.id,
          name: chat.title,
          username: normalizedUsername,
          type: 'chat',
        });
      }
    });

    return Array.from(results.values()).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
  }, [searchQuery, safeUsers, safeChats]);

  const getUserInfo = useCallback((userId: string) => {
    const user = safeUsers[userId];
    if (user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      return {
        title: fullName || user.firstName || user.lastName || `User ${userId}`,
        username: user.usernames?.[0]?.username || user.username,
        isChat: false,
      };
    }

    const chat = Object.values(safeChats).find((item) => item.id === userId);
    if (chat) {
      const username = chat.usernames?.[0]?.username;
      return {
        title: chat.title || 'Unknown Chat',
        username,
        isChat: true,
      };
    }

    return {
      title: `User ${userId}`,
      username: undefined,
      isChat: false,
    };
  }, [safeUsers, safeChats]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setSearchQuery(value);
    setIsSearchDropdownOpen(Boolean(value));
  };

  const handleSelectSearchResult = (result: SearchResult) => {
    if (!safeFilteredUserIds.includes(result.id)) {
      onChange([
        ...safeFilteredUserIds,
        result.id,
      ]);
    }

    setSearchQuery('');
    setIsSearchDropdownOpen(false);
  };

  const handleCloseSearchDropdown = () => {
    setIsSearchDropdownOpen(false);
  };

  const handleRemoveUserId = (userId: string) => {
    onChange(safeFilteredUserIds.filter((id) => id !== userId));
  };

  return (
    <div className={layoutStyles.tabContent}>
      <div className={layoutStyles.sectionHeader}>
        <h3>
          <Icon name="user" className={layoutStyles.sectionIcon} />
          {lang('CustomerServiceFilteredUserIds')}
        </h3>
        <p className={layoutStyles.sectionDescription}>
          {lang('CustomerServiceFilteredUserIdsDescription')}
        </p>
      </div>

      <div className={styles.addSection}>
        <div className={styles.searchContainer}>
          <div className={styles.userAddInputWrapper}>
            <Icon name="search" className={styles.inputIcon} />
            <InputText
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={lang('CustomerServiceSearchUsers')}
              className={styles.userAddInput}
            />
          </div>

          {isSearchDropdownOpen && searchResults.length > 0 && (
            <>
              <div className={styles.searchDropdown}>
                {searchResults.map((result, index) => (
                  <div
                    key={`${result.type}-${result.id}-${index}`}
                    className={styles.searchResultItem}
                    onClick={() => handleSelectSearchResult(result)}
                  >
                    <div className={styles.resultAvatar}>
                      <Icon name={result.type === 'user' ? 'user' : 'group'} />
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
                  </div>
                ))}
              </div>
              <div className={styles.searchOverlay} onClick={handleCloseSearchDropdown} />
            </>
          )}
        </div>
      </div>

      {safeFilteredUserIds.length > 0 ? (
        <div className={styles.filterList}>
          {safeFilteredUserIds.map((userId) => {
            const userInfo = getUserInfo(userId);
            return (
              <div key={userId} className={styles.filterItem}>
                <div className={styles.filterContent}>
                  <div className={styles.userAvatar}>
                    <Icon name="user" className={styles.filterIcon} />
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName}>{userInfo.title}</div>
                    <div className={styles.userDetails}>
                      <span className={styles.userId}>{userId}</span>
                      {userInfo.username && (
                        <span className={styles.userUsername}>
                          @
                          {userInfo.username}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <Button
                    size="tiny"
                    color="translucent"
                    onClick={() => handleRemoveUserId(userId)}
                    className={styles.removeButton}
                    ariaLabel={lang('CustomerServiceRemoveFilteredUser')}
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
          <Icon name="user" className={styles.emptyIcon} />
          <p>{lang('CustomerServiceNoFilteredUsers')}</p>
        </div>
      )}
    </div>
  );
};

export default memo(UserFiltersTab);
