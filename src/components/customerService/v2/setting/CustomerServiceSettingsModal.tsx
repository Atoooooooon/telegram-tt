import type React from '../../../../lib/teact/teact';
import { memo, useEffect, useMemo, useState } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiChat } from '../../../../api/types';

import { CUSTOMER_SERVICE_CONFIG } from '../../../../config/customerService';
import { selectCustomerServiceV2Settings } from '../../../../global/selectors/customerServiceV2';
import { selectTabState } from '../../../../global/selectors/tabs';
import buildClassName from '../../../../util/buildClassName';
import { getChatFolderIds } from '../../../../util/folderManager';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Icon from '../../../common/icons/Icon';
import Button from '../../../ui/Button';
import Checkbox from '../../../ui/Checkbox';
import InputText from '../../../ui/InputText';
import TextArea from '../../../ui/TextArea';
import Modal from '../../../ui/Modal';
import TabList from '../../../ui/TabList';

import styles from './CustomerServiceSettingsModal.module.scss';

type StateProps = {
  isOpen?: boolean;
  chats: Record<string, ApiChat>;
  users: Record<string, any>;
  chatFolders: Record<number, any>;
  orderedFolderIds?: number[];
  savedSettings?: {
    monitoredChatIds: string[];
    filteredUserIds: string[];
    regexFilters: Array<{
      source: string;
      flags: string;
    }>;
    mode?: 'oncall' | 'assist';
    autoRead?: boolean;
    quickReplies?: string[];
  };
};

type FilterSettings = {
  monitoredChatIds: string[];
  filteredUserIds: string[];
  regexFilters: RegExp[];
  mode?: 'oncall' | 'assist'; // 添加模式选择
  autoRead?: boolean; // 添加自动已读选项
  quickReplies: string[];
};

const normalizeQuickReplies = (list?: readonly string[]) => {
  if (!Array.isArray(list)) {
    return Array.from(CUSTOMER_SERVICE_CONFIG.QUICK_REPLIES);
  }

  return list.reduce<string[]>((result, item) => {
    if (item === undefined || item === null) {
      return result;
    }

    const text = item.trim();
    if (text) {
      result.push(text);
    }

    return result;
  }, []);
};

type SavedSettings = StateProps['savedSettings'];

const buildFilterSettings = (saved?: SavedSettings): FilterSettings => ({
  monitoredChatIds: saved?.monitoredChatIds
    ? [...saved.monitoredChatIds]
    : Array.from(CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS),
  filteredUserIds: saved?.filteredUserIds
    ? [...saved.filteredUserIds]
    : Array.from(CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS),
  regexFilters: saved?.regexFilters
    ? saved.regexFilters.map((pattern) => new RegExp(pattern.source, pattern.flags))
    : [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS],
  mode: saved?.mode || 'oncall',
  autoRead: saved?.autoRead || false,
  quickReplies: normalizeQuickReplies(saved?.quickReplies),
});

const CustomerServiceSettingsModal = ({
  isOpen,
  chats,
  users,
  chatFolders,
  orderedFolderIds,
  savedSettings,
}: StateProps) => {
  const {
    initializeCustomerServiceV2Settings,
    closeCustomerServiceV2Settings,
    saveCustomerServiceV2Settings,
    exportCustomerServiceV2Settings,
    importCustomerServiceV2Settings,
  } = getActions();
  const lang = useLang();

  // 获取用户信息的函数
  const getUserInfo = (userId: string) => {
    // 先从用户列表查找
    const user = users[userId];
    if (user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      return {
        title: fullName || user.firstName || user.lastName || `User ${userId}`,
        username: user.usernames?.[0]?.username || user.username,
        isChat: false,
      };
    }

    // 尝试从聊天列表中查找（可能是群组或私聊）
    const chat = Object.values(chats).find((chat) => chat.id === userId);
    if (chat) {
      const username = chat.usernames?.[0]?.username;
      return {
        title: chat.title || 'Unknown Chat',
        username,
        isChat: true,
      };
    }

    // 如果没找到，显示用户ID
    return {
      title: `User ${userId}`,
      username: undefined,
      isChat: false,
    };
  };

  // 当前选中的标签页
  const [activeTab, setActiveTab] = useState(0);

  // 标签筛选状态
  const [selectedTagId, setSelectedTagId] = useState<string>('-1'); // '-1'表示所有标签

  // 群组搜索状态
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [searchError, setSearchError] = useState('');

  // 设置状态
  const [settings, setSettings] = useState<FilterSettings>(() => buildFilterSettings(savedSettings));

  // 新添加的用户ID和正则规则输入
  const [newRegexFilter, setNewRegexFilter] = useState('');
  const [regexValidationError, setRegexValidationError] = useState('');

  // 快捷回复输入
  const [newQuickReply, setNewQuickReply] = useState('');

  // 用户搜索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);

  // 搜索结果计算
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }

    const query = searchQuery.toLowerCase();
    const results: Array<{ id: string; name: string; username?: string; type: 'user' | 'chat' }> = [];

    // 搜索用户
    Object.values(users).forEach((user) => {
      if (!user) return;

      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
      const username = user.usernames?.[0]?.username || user.username;

      const nameMatch = fullName.toLowerCase().includes(query);
      const usernameMatch = username && username.toLowerCase().includes(query);
      const idMatch = user.id.includes(query);

      if (nameMatch || usernameMatch || idMatch) {
        results.push({
          id: user.id,
          name: fullName || user.firstName || user.lastName || `User ${user.id}`,
          username,
          type: 'user',
        });
      }
    });

    // 搜索聊天（群组和私聊）
    Object.values(chats).forEach((chat) => {
      if (!chat || !chat.title) return;

      const normalizedUsername = chat.usernames?.[0]?.username;
      const titleMatch = chat.title.toLowerCase().includes(query);
      const usernameMatch = normalizedUsername && normalizedUsername.toLowerCase().includes(query);
      const idMatch = chat.id.includes(query);

      if (titleMatch || usernameMatch || idMatch) {
        results.push({
          id: chat.id,
          name: chat.title,
          username: normalizedUsername,
          type: 'chat',
        });
      }
    });

    // 按照名称排序并限制结果数量
    return results.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 10);
  }, [searchQuery, users, chats]);

  // 全选状态
  const [isAllSelected, setIsAllSelected] = useState(false);

  // 标记是否已经初始化，避免覆盖用户编辑
  const [hasInitialized, setHasInitialized] = useState(false);
  useEffect(() => {
    if (!isOpen) {
      setHasInitialized(false);
      return;
    }

    if (hasInitialized) {
      return;
    }

    if (savedSettings) {
      setSettings(buildFilterSettings(savedSettings));
      setHasInitialized(true);
      return;
    }

    setSettings(buildFilterSettings());
    setHasInitialized(true);
  }, [hasInitialized, isOpen, savedSettings]);

  const handleClose = useLastCallback(() => {
    setSelectedTagId('-1');
    setIsSearchDropdownOpen(false);
    setGroupSearchQuery('');
    setSearchError('');
    setSearchQuery('');
    setNewRegexFilter('');
    setRegexValidationError('');
    setNewQuickReply('');
    setIsAllSelected(false);
    setHasInitialized(false);
    closeCustomerServiceV2Settings({});
  });

  // 组件挂载时初始化设置
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    initializeCustomerServiceV2Settings({});
  }, [initializeCustomerServiceV2Settings, isOpen]);

  // 只在首次加载且未初始化时更新设置状态
  useEffect(() => {
    if (savedSettings && !hasInitialized) {
      setSettings(buildFilterSettings(savedSettings));
      setHasInitialized(true);
    }
  }, [savedSettings, hasInitialized]);

  // 简化：直接获取所有群组
  const allGroupChats = useMemo(() => {
    if (!chats) return [];

    return Object.values(chats).filter((chat) =>
      chat
      && (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup')
      && !chat.isNotJoined,
    );
  }, [chats]);

  // 过滤后的群组列表（根据选中的标签和搜索）
  const groupChats = useMemo(() => {
    let filteredChats = allGroupChats;

    // 按标签过滤
    if (selectedTagId !== '-1') {
      const selectedFolderId = parseInt(selectedTagId, 10);
      filteredChats = filteredChats.filter((chat) => {
        const folderIds = getChatFolderIds(chat.id);
        return folderIds && folderIds.includes(selectedFolderId);
      });
    }

    // 按搜索查询过滤
    if (groupSearchQuery.trim()) {
      const query = groupSearchQuery.trim();

      // 尝试作为正则表达式解析
      try {
        const regex = new RegExp(query, 'i');
        filteredChats = filteredChats.filter((chat) => regex.test(chat.title || ''));
        setSearchError('');
      } catch (error) {
        // 如果不是有效的正则表达式，则作为普通文本搜索
        const lowerQuery = query.toLowerCase();
        filteredChats = filteredChats.filter((chat) =>
          chat.title?.toLowerCase().includes(lowerQuery)
          || chat.id.includes(query),
        );
        setSearchError('');
      }
    } else {
      setSearchError('');
    }

    return filteredChats;
  }, [selectedTagId, allGroupChats, groupSearchQuery]);

  // 检查全选状态
  useEffect(() => {
    const allGroupIds = groupChats.map((chat) => chat.id);
    const selectedCount = (settings.monitoredChatIds || []).filter((id) => allGroupIds.includes(id)).length;
    setIsAllSelected(selectedCount === allGroupIds.length && allGroupIds.length > 0);
  }, [settings.monitoredChatIds, groupChats]);

  // 处理群组勾选
  const handleChatToggle = useLastCallback((chatId: string, isChecked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      monitoredChatIds: isChecked
        ? [...(prev.monitoredChatIds || []), chatId]
        : (prev.monitoredChatIds || []).filter((id) => id !== chatId),
    }));
  });

  const handleRegexFilter = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    setNewRegexFilter(value);

    // 实时验证正则表达式
    if (value.trim()) {
      try {
        new RegExp(value.trim());
        setRegexValidationError('');
      } catch (error) {
        setRegexValidationError('Invalid regular expression');
      }
    } else {
      setRegexValidationError('');
    }
  });

  // 处理全选
  const handleSelectAll = useLastCallback(() => {
    const allGroupIds = groupChats.map((chat) => chat.id);
    if (isAllSelected) {
      // 取消全选
      setSettings((prev) => ({
        ...prev,
        monitoredChatIds: (prev.monitoredChatIds || []).filter((id) => !allGroupIds.includes(id)),
      }));
    } else {
      // 全选
      setSettings((prev) => ({
        ...prev,
        monitoredChatIds: [...new Set([...(prev.monitoredChatIds || []), ...allGroupIds])],
      }));
    }
  });

  // 处理搜索输入变化
  const handleSearchChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setIsSearchDropdownOpen(value.length > 0);
  });

  // 选择搜索结果
  const handleSelectSearchResult = useLastCallback((result: {
    id: string;
    name: string;
    username?: string;
    type: 'user' | 'chat';
  }) => {
    // 检查是否已经存在
    if (!(settings.filteredUserIds || []).includes(result.id)) {
      setSettings((prev) => ({
        ...prev,
        filteredUserIds: [...(prev.filteredUserIds || []), result.id],
      }));
    }

    // 清空搜索
    setSearchQuery('');
    setIsSearchDropdownOpen(false);
  });

  // 关闭搜索下拉框
  const handleCloseSearchDropdown = useLastCallback(() => {
    setIsSearchDropdownOpen(false);
  });

  // 删除用户ID过滤
  const handleRemoveUserId = useLastCallback((userId: string) => {
    setSettings((prev) => ({
      ...prev,
      filteredUserIds: (prev.filteredUserIds || []).filter((id) => id !== userId),
    }));
  });

  // 添加正则过滤规则
  const handleAddRegexFilter = useLastCallback(() => {
    const trimmedPattern = newRegexFilter.trim();
    if (!trimmedPattern || regexValidationError) return;

    try {
      const regex = new RegExp(trimmedPattern);
      // 检查是否已存在相同的规则
      const isDuplicate = (settings.regexFilters || []).some(
        (existingRegex) => existingRegex.source === trimmedPattern,
      );

      if (!isDuplicate) {
        setSettings((prev) => ({
          ...prev,
          regexFilters: [...(prev.regexFilters || []), regex],
        }));
        setNewRegexFilter('');
        setRegexValidationError('');
      }
    } catch (error) {
      setRegexValidationError('Invalid regular expression');
    }
  });

  // 删除正则过滤规则
  const handleRemoveRegexFilter = useLastCallback((index: number) => {
    setSettings((prev) => ({
      ...prev,
      regexFilters: (prev.regexFilters || []).filter((_, i) => i !== index),
    }));
  });

  const handleQuickReplyChange = useLastCallback((index: number, value: string) => {
    setSettings((prev) => {
      const nextQuickReplies = [...(prev.quickReplies || [])];
      nextQuickReplies[index] = value;

      return {
        ...prev,
        quickReplies: nextQuickReplies,
      };
    });
  });

  const handleRemoveQuickReply = useLastCallback((index: number) => {
    setSettings((prev) => {
      const nextQuickReplies = [...(prev.quickReplies || [])];
      nextQuickReplies.splice(index, 1);

      return {
        ...prev,
        quickReplies: nextQuickReplies,
      };
    });
  });

  const handleAddQuickReply = useLastCallback(() => {
    const trimmed = newQuickReply.trim();
    if (!trimmed) {
      return;
    }

    setSettings((prev) => ({
      ...prev,
      quickReplies: [...(prev.quickReplies || []), trimmed],
    }));
    setNewQuickReply('');
  });

  // 保存设置
  const handleSave = useLastCallback(() => {
    const normalizedSettings = {
      monitoredChatIds: [...(settings.monitoredChatIds || [])],
      filteredUserIds: [...(settings.filteredUserIds || [])],
      regexFilters: (settings.regexFilters || []).map((regex) => ({
        source: regex.source,
        flags: regex.flags,
      })),
      mode: settings.mode || 'oncall',
      autoRead: Boolean(settings.autoRead),
      quickReplies: (settings.quickReplies || []).reduce<string[]>((result, reply) => {
        if (reply === undefined || reply === null) {
          return result;
        }

        const text = reply.trim();
        if (text) {
          result.push(text);
        }

        return result;
      }, []),
    };

    saveCustomerServiceV2Settings({ settings: normalizedSettings });
    setSelectedTagId('-1');
    handleClose();
  });

  // 重置设置
  const handleReset = useLastCallback(() => {
    setSettings(buildFilterSettings());
    setNewQuickReply('');
  });

  // 导出配置
  const handleExportSettings = useLastCallback(() => {
    exportCustomerServiceV2Settings({});
  });

  // 导入配置
  const handleImportSettings = useLastCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const fileContent = event.target?.result as string;
          if (fileContent) {
            importCustomerServiceV2Settings({ fileContent });
            setHasInitialized(false);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  });

  // 切换自动已读
  const handleAutoReadChange = useLastCallback((checked: boolean) => {
    setSettings((prev) => ({
      ...prev,
      autoRead: checked,
    }));
  });

  // 处理群组搜索输入变化
  const handleGroupSearchChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setGroupSearchQuery(e.target.value);
  });

  // 清除搜索
  const handleClearGroupSearch = useLastCallback(() => {
    setGroupSearchQuery('');
    setSearchError('');
  });

  // 获取群组的标签信息
  const getChatTagsName = (chat: ApiChat) => {
    const folderIds = getChatFolderIds(chat.id);
    if (!folderIds || folderIds.length === 0) return undefined;

    const tagNames = folderIds.map((folderId) => {
      const folder = chatFolders[folderId];
      return folder?.title?.text;
    }).filter(Boolean).join(', ');

    return tagNames || undefined;
  };

  // 标签选项 - 按照ChatFolders.tsx的模式生成
  const tagOptions = useMemo(() => {
    const options = [{ value: '-1', text: lang('All') }];

    if (orderedFolderIds && chatFolders) {
      orderedFolderIds.forEach((folderId) => {
        const folder = chatFolders[folderId];
        // 跳过ALL_FOLDER_ID(-1)，只显示实际创建的folder
        if (folder && folderId !== -1 && folder.title?.text) {
          options.push({
            value: folderId.toString(),
            text: folder.title.text,
          });
        }
      });
    }

    return options;
  }, [orderedFolderIds, chatFolders, lang]);

  const tabs = [
    { title: lang('CustomerServiceGroupFilters') },
    { title: lang('CustomerServiceUserFilters') },
    { title: lang('CustomerServiceMessageFilters') },
    { title: lang('CustomerServiceQuickReplies') },
  ];

  const renderGroupFilters = () => (
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
            onChange={(e) => setSelectedTagId(e.target.value)}
          >
            {tagOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </div>

        {/* 群组搜索区域 */}
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

      {/* 搜索错误提示 */}
      {searchError && (
        <div className={styles.searchError}>
          <Icon name="warning" className={styles.errorIcon} />
          {searchError}
        </div>
      )}

      <div className={styles.groupList}>
        {groupChats.length > 0 ? (
          groupChats.map((chat) => {
            const isChecked = (settings.monitoredChatIds || []).includes(chat.id);
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
            <Icon name="folder-open" className={styles.emptyIcon} />
            <p>{lang('CustomerServiceNoGroups')}</p>
          </div>
        )}
      </div>

      <div className={styles.selectedCount}>
        <Icon name="check-circle" className={styles.countIcon} />
        <strong>{(settings.monitoredChatIds || []).length}</strong>
        {' '}
        {lang('CustomerServiceGroupsSelected')}
      </div>
    </div>
  );

  const renderUserFilters = () => (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h3>
          <Icon name="user" className={styles.sectionIcon} />
          {lang('CustomerServiceFilteredUserIds')}
        </h3>
        <p className={styles.sectionDescription}>
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
              onFocus={() => setIsSearchDropdownOpen(searchQuery.length > 0)}
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

      {(settings.filteredUserIds || []).length > 0 ? (
        <div className={styles.filterList}>
          {(settings.filteredUserIds || []).map((userId) => {
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
                    ariaLabel={lang('Remove')}
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
          <Icon name="user-check" className={styles.emptyIcon} />
          <p>{lang('CustomerServiceNoFilteredUsers')}</p>
        </div>
      )}
    </div>
  );

  // 预设的常用正则规则
  const presetRegexRules = [
    { pattern: '^/\\w+', description: lang('CustomerServiceRegexExample1') },
    { pattern: '^@\\w+', description: lang('CustomerServiceRegexExample2') },
    { pattern: '^\\[系统\\]', description: lang('CustomerServiceRegexExample3') },
    { pattern: 'bot$', description: lang('CustomerServiceRegexExample4') },
  ];

  // 添加预设规则
  const handleAddPresetRegex = useLastCallback((pattern: string) => {
    try {
      const regex = new RegExp(pattern);
      const isAlreadyAdded = (settings.regexFilters || []).some((existingRegex) => existingRegex.source === pattern);

      if (!isAlreadyAdded) {
        setSettings((prev) => ({
          ...prev,
          regexFilters: [...(prev.regexFilters || []), regex],
        }));
      }
    } catch (error) {
      // 忽略无效的预设规则
    }
  });

  const renderMessageFilters = () => (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h3>
          <Icon name="filter" className={styles.sectionIcon} />
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
            onChange={handleRegexFilter}
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

      {(settings.regexFilters || []).length > 0 ? (
        <div className={styles.regexFilterList}>
          {(settings.regexFilters || []).map((regex, index) => {
            // 查找匹配的预设规则描述
            const presetRule = presetRegexRules.find((rule) => rule.pattern === regex.source);

            return (
              <div key={index} className={styles.filterItem}>
                <div className={styles.filterContent}>
                  <Icon name="code" className={styles.filterIcon} />
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
                    ariaLabel={lang('Remove')}
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
          <Icon name="filter-off" className={styles.emptyIcon} />
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
          <li>
            <code>^/\w+</code>
            {' '}
            -
            {' '}
            {lang('CustomerServiceRegexExample1')}
          </li>
          <li>
            <code>^@\w+</code>
            {' '}
            -
            {' '}
            {lang('CustomerServiceRegexExample2')}
          </li>
          <li>
            <code>^\[系统\]</code>
            {' '}
            -
            {' '}
            {lang('CustomerServiceRegexExample3')}
          </li>
          <li>
            <code>bot$</code>
            {' '}
            -
            {' '}
            {lang('CustomerServiceRegexExample4')}
          </li>
        </ul>
      </div>
    </div>
  );

  const renderQuickReplies = () => {
    const quickReplies = settings.quickReplies || [];

    return (
      <div className={styles.tabContent}>
        <div className={styles.sectionHeader}>
          <h3>
            <Icon name="flash" className={styles.sectionIcon} />
            {lang('CustomerServiceQuickReplies')}
          </h3>
          <p className={styles.sectionDescription}>
            {lang('CustomerServiceQuickRepliesDescription')}
          </p>
        </div>

        <div className={styles.quickReplyCreator}>
          <TextArea
            value={newQuickReply}
            onChange={(e) => setNewQuickReply(e.currentTarget.value)}
            placeholder={lang('CustomerServiceQuickReplyPlaceholder')}
            className={styles.quickReplyTextarea}
            rows={2}
            noReplaceNewlines
          />
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

        {quickReplies.length > 0 ? (
          <div className={styles.quickReplyList}>
            {quickReplies.map((reply, index) => (
              <div
                key={`quick-reply-${index}`}
                className={styles.quickReplyItem}
              >
                <TextArea
                  value={reply}
                  onChange={(e) => handleQuickReplyChange(index, e.currentTarget.value)}
                  className={styles.quickReplyTextarea}
                  rows={2}
                  noReplaceNewlines
                />
                <Button
                  size="tiny"
                  color="translucent"
                  round
                  className={styles.quickReplyRemoveButton}
                  onClick={() => handleRemoveQuickReply(index)}
                  ariaLabel={lang('CustomerServiceDeleteQuickReply')}
                >
                  <Icon name="delete" />
                </Button>
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

  if (!isOpen) {
    return undefined;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className={styles.modal}
      headerClassName={styles.header}
      title={(
        <div className={styles.titleRow}>
          <Icon name="settings" className={styles.titleIcon} />
          <TabList
            tabs={tabs}
            activeTab={activeTab}
            onSwitchTab={setActiveTab}
            className={styles.tabs}
          />
        </div>
      )}
    >
      <div className={styles.settingsModal}>

        <div className={styles.content}>
          {activeTab === 0 && renderGroupFilters()}
          {activeTab === 1 && renderUserFilters()}
          {activeTab === 2 && renderMessageFilters()}
          {activeTab === 3 && renderQuickReplies()}
        </div>

        <div className={styles.footer}>
          <div className={styles.leftSection}>
            {/* 模式切换 */}
            {/* <div className={styles.modeSection}>
              <span className={styles.sectionLabel}>工作模式:</span>
              <div className={styles.modeToggle}>
                <button
                  type="button"
                  className={buildClassName(
                    styles.modeButton,
                    settings.mode === 'oncall' && styles.active,
                  )}
                  onClick={() => handleModeChange('oncall')}
                >
                  值班
                </button>
                <button
                  type="button"
                  className={buildClassName(
                    styles.modeButton,
                    settings.mode === 'assist' && styles.active,
                  )}
                  onClick={() => handleModeChange('assist')}
                >
                  辅助
                </button>
              </div>
            </div> */}

            {/* 自动已读 */}
            {/* <div className={styles.autoReadSection}> */}
            {/* <label className={styles.autoReadLabel}> */}
            <Checkbox
              label={lang('CustomerServiceAutoRead')}
              className={styles.autoReadCheckbox}
              checked={Boolean(settings.autoRead)}
              onChange={(e) => handleAutoReadChange(e.currentTarget.checked)}
            />
            {/* </label> */}
            {/* </div> */}
          </div>

          <div className={styles.rightSection}>
            <Button
              size="smaller"
              color="translucent"
              style="width: 5rem !important;"
              onClick={handleExportSettings}
              title={lang('CustomerServiceExportDescription')}
            >
              <Icon name="download" />
              导出
            </Button>
            <Button
              size="smaller"
              color="translucent"
              style="width: 5rem !important;"
              onClick={handleImportSettings}
              title={lang('CustomerServiceImportDescription')}
            >
              <Icon name="upload" />
              导入
            </Button>
            <Button
              size="smaller"
              color="translucent"
              style="width: 5rem !important;"
              onClick={handleReset}
            >
              <Icon name="restart" />
              重置
            </Button>
            <Button
              size="smaller"
              color="translucent"
              style="width: 5rem !important;"
              onClick={handleClose}
            >
              <Icon name="close" />
              取消
            </Button>
            <Button
              size="smaller"
              color="primary"
              style="width: 5rem !important;"
              onClick={handleSave}
            >
              <Icon name="check" />
              保存
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default memo(withGlobal((global): StateProps => {
  const chats = global.chats.byId;
  const users = global.users.byId;
  const {
    byId: chatFolders,
    orderedIds: orderedFolderIds,
  } = global.chatFolders || {};
  const savedSettings = selectCustomerServiceV2Settings(global);
  const tabState = selectTabState(global);

  return {
    isOpen: tabState.isCustomerServiceV2SettingsOpen,
    chats,
    users,
    chatFolders: chatFolders || {},
    orderedFolderIds,
    savedSettings,
  };
})(CustomerServiceSettingsModal));
