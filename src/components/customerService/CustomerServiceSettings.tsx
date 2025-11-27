import React, { memo, useState, useEffect, useMemo } from '../../lib/teact/teact';
import { withGlobal, getActions } from '../../global';

import type { ApiChat } from '../../api/types';
import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import { selectCustomerServiceSettings } from '../../global/selectors/customerService';
import { useFolderManagerForOrderedIds } from '../../hooks/useFolderManager';
import { getChatFolderIds } from '../../util/folderManager';

import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import InputText from '../ui/InputText';
import TabList from '../ui/TabList';
import Icon from '../common/icons/Icon';
import Select from '../ui/Select';
import buildClassName from '../../util/buildClassName';

import styles from './CustomerServiceSettings.module.scss';

type OwnProps = {
  isOpen?: boolean;
  onClose: NoneToVoidFunction;
};

type StateProps = {
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
  };
};

type FilterSettings = {
  monitoredChatIds: string[];
  filteredUserIds: string[];
  regexFilters: RegExp[];
  mode?: 'oncall' | 'assist'; // 添加模式选择
  autoRead?: boolean; // 添加自动已读选项
};

const CustomerServiceSettings = ({
  isOpen,
  onClose,
  chats,
  users,
  chatFolders,
  orderedFolderIds,
  savedSettings,
}: OwnProps & StateProps) => {
  const { initializeCustomerServiceSettings } = getActions();
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
        isChat: false
      };
    }
    
    // 尝试从聊天列表中查找（可能是群组或私聊）
    const chat = Object.values(chats).find(chat => chat.id === userId);
    if (chat) {
      return {
        title: chat.title || 'Unknown Chat',
        username: chat.username,
        isChat: true
      };
    }
    
    // 如果没找到，显示用户ID
    return {
      title: `User ${userId}`,
      username: undefined,
      isChat: false
    };
  };

  // 当前选中的标签页
  const [activeTab, setActiveTab] = useState(0);
  
  // 标签筛选状态
  const [selectedTagId, setSelectedTagId] = useState<string>('-1'); // '-1'表示所有标签
  
  // 设置状态
  const [settings, setSettings] = useState<FilterSettings>(() => {
    // 优先使用已保存的设置，否则使用配置文件的默认值
    if (savedSettings) {
      return {
        monitoredChatIds: [...savedSettings.monitoredChatIds],
        filteredUserIds: [...savedSettings.filteredUserIds],
        regexFilters: savedSettings.regexFilters.map(pattern => new RegExp(pattern.source, pattern.flags)),
        mode: savedSettings.mode || 'oncall',
        autoRead: savedSettings.autoRead || false,
      };
    }
    
    return {
      monitoredChatIds: [...CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS],
      filteredUserIds: [...CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS],
      regexFilters: [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS],
      mode: 'oncall',
      autoRead: false,
    };
  });

  // 新添加的用户ID和正则规则输入
  const [newUserId, setNewUserId] = useState('');
  const [newRegexFilter, setNewRegexFilter] = useState('');
  const [regexValidationError, setRegexValidationError] = useState('');
  
  // 用户搜索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  
  // 搜索结果计算
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    
    const query = searchQuery.toLowerCase();
    const results: Array<{id: string, name: string, username?: string, type: 'user' | 'chat'}> = [];
    
    // 搜索用户
    Object.values(users).forEach(user => {
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
          type: 'user'
        });
      }
    });
    
    // 搜索聊天（群组和私聊）
    Object.values(chats).forEach(chat => {
      if (!chat || !chat.title) return;
      
      const titleMatch = chat.title.toLowerCase().includes(query);
      const usernameMatch = chat.username && chat.username.toLowerCase().includes(query);
      const idMatch = chat.id.includes(query);
      
      if (titleMatch || usernameMatch || idMatch) {
        results.push({
          id: chat.id,
          name: chat.title,
          username: chat.username,
          type: 'chat'
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
  
  // 组件挂载时初始化设置
  useEffect(() => {
    initializeCustomerServiceSettings();
  }, [initializeCustomerServiceSettings]);
  
  // 只在首次加载且未初始化时更新设置状态
  useEffect(() => {
    if (savedSettings && !hasInitialized) {
      setSettings({
        monitoredChatIds: [...savedSettings.monitoredChatIds],
        filteredUserIds: [...savedSettings.filteredUserIds],
        regexFilters: savedSettings.regexFilters.map(pattern => new RegExp(pattern.source, pattern.flags)),
        mode: savedSettings.mode || 'oncall',
        autoRead: savedSettings.autoRead || false,
      });
      setHasInitialized(true);
    }
  }, [savedSettings, hasInitialized]);

  // 简化：直接获取所有群组
  const allGroupChats = useMemo(() => {
    if (!chats) return [];
    
    return Object.values(chats).filter(chat => 
      chat && 
      (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup') && 
      !chat.isNotJoined
    );
  }, [chats]);

  // 过滤后的群组列表（根据选中的标签）
  const groupChats = useMemo(() => {
    if (selectedTagId === '-1') {
      // 显示所有群组
      return allGroupChats;
    } else {
      // 显示有特定标签的群组
      const selectedFolderId = parseInt(selectedTagId, 10);
      return allGroupChats.filter(chat => {
        const folderIds = getChatFolderIds(chat.id);
        return folderIds && folderIds.includes(selectedFolderId);
      });
    }
  }, [selectedTagId, allGroupChats]);

  // 检查全选状态
  useEffect(() => {
    const allGroupIds = groupChats.map(chat => chat.id);
    const selectedCount = (settings.monitoredChatIds || []).filter(id => allGroupIds.includes(id)).length;
    setIsAllSelected(selectedCount === allGroupIds.length && allGroupIds.length > 0);
  }, [settings.monitoredChatIds, groupChats]);

  // 处理群组勾选
  const handleChatToggle = useLastCallback((chatId: string, isChecked: boolean) => {
    setSettings(prev => ({
      ...prev,
      monitoredChatIds: isChecked
        ? [...(prev.monitoredChatIds || []), chatId]
        : (prev.monitoredChatIds || []).filter(id => id !== chatId)
    }));
  });

  const handleUserId = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setNewUserId(e.currentTarget.value);
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
    const allGroupIds = groupChats.map(chat => chat.id);
    if (isAllSelected) {
      // 取消全选
      setSettings(prev => ({
        ...prev,
        monitoredChatIds: (prev.monitoredChatIds || []).filter(id => !allGroupIds.includes(id))
      }));
    } else {
      // 全选
      setSettings(prev => ({
        ...prev,
        monitoredChatIds: [...new Set([...(prev.monitoredChatIds || []), ...allGroupIds])]
      }));
    }
  });

  // 添加用户ID过滤
  const handleAddUserId = useLastCallback(() => {
    const trimmedInput = newUserId.trim();
    if (!trimmedInput) return;
    
    // 支持批量输入，用空格分隔多个ID
    const userIds = trimmedInput.split(/\s+/).filter(id => id.trim());
    const validIds: string[] = [];
    
    userIds.forEach(id => {
      const trimmedId = id.trim();
      // 基本验证：检查是否为数字或以-开头的数字（群组ID）
      const isValidId = /^-?\d+$/.test(trimmedId);
      if (isValidId && !(settings.filteredUserIds || []).includes(trimmedId)) {
        validIds.push(trimmedId);
      }
    });
    
    // 批量添加有效的ID
    if (validIds.length > 0) {
      setSettings(prev => ({
        ...prev,
        filteredUserIds: [...(prev.filteredUserIds || []), ...validIds]
      }));
      setNewUserId('');
    }
  });
  
  // 处理搜索输入变化
  const handleSearchChange = useLastCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setIsSearchDropdownOpen(value.length > 0);
  });
  
  // 选择搜索结果
  const handleSelectSearchResult = useLastCallback((result: {id: string, name: string, username?: string, type: 'user' | 'chat'}) => {
    // 检查是否已经存在
    if (!(settings.filteredUserIds || []).includes(result.id)) {
      setSettings(prev => ({
        ...prev,
        filteredUserIds: [...(prev.filteredUserIds || []), result.id]
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
    setSettings(prev => ({
      ...prev,
      filteredUserIds: (prev.filteredUserIds || []).filter(id => id !== userId)
    }));
  });

  // 添加正则过滤规则
  const handleAddRegexFilter = useLastCallback(() => {
    const trimmedPattern = newRegexFilter.trim();
    if (!trimmedPattern || regexValidationError) return;
    
    try {
      const regex = new RegExp(trimmedPattern);
      // 检查是否已存在相同的规则
      const isDuplicate = (settings.regexFilters || []).some(existingRegex => existingRegex.source === trimmedPattern);
      
      if (!isDuplicate) {
        setSettings(prev => ({
          ...prev,
          regexFilters: [...(prev.regexFilters || []), regex]
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
    setSettings(prev => ({
      ...prev,
      regexFilters: (prev.regexFilters || []).filter((_, i) => i !== index)
    }));
  });

  // 保存设置
  const handleSave = useLastCallback(() => {
    const { saveCustomerServiceSettings } = getActions();
    saveCustomerServiceSettings({ settings });
    setSelectedTagId('-1'); // 重置筛选
    onClose();
  });

  // 重置设置
  const handleReset = useLastCallback(() => {
    setSettings({
      monitoredChatIds: [...CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS],
      filteredUserIds: [...CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS],
      regexFilters: [...CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS],
      mode: 'oncall',
      autoRead: false,
    });
  });

  // 切换模式
  const handleModeChange = useLastCallback((newMode: 'oncall' | 'assist') => {
    setSettings(prev => ({
      ...prev,
      mode: newMode,
    }));
  });

  // 切换自动已读
  const handleAutoReadChange = useLastCallback((checked: boolean) => {
    setSettings(prev => ({
      ...prev,
      autoRead: checked,
    }));
  });

  // 获取群组的标签信息
  const getChatTagsName = (chat: ApiChat) => {
    const folderIds = getChatFolderIds(chat.id);
    if (!folderIds || folderIds.length === 0) return null;
    
    const tagNames = folderIds.map(folderId => {
      const folder = chatFolders[folderId];
      return folder?.title?.text;
    }).filter(Boolean).join(', ');
    
    return tagNames || null;
  };

  // 标签选项 - 按照ChatFolders.tsx的模式生成
  const tagOptions = useMemo(() => {
    const options = [{ value: '-1', text: lang('All') }];
    
    if (orderedFolderIds && chatFolders) {
      orderedFolderIds.forEach(folderId => {
        const folder = chatFolders[folderId];
        // 跳过ALL_FOLDER_ID(-1)，只显示实际创建的folder
        if (folder && folderId !== -1 && folder.title?.text) {
          options.push({
            value: folderId.toString(),
            text: folder.title.text
          });
        }
      });
    }
    
    return options;
  }, [orderedFolderIds, chatFolders]);

  const tabs = [
    { title: lang('CustomerServiceGroupFilters') },
    { title: lang('CustomerServiceUserFilters') },
    { title: lang('CustomerServiceMessageFilters') },
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
          <label>{lang('CustomerServiceFilterByTag')}:</label>
          <select
            value={selectedTagId}
            onChange={(e) => setSelectedTagId(e.target.value)}
          >
            {tagOptions.map(option => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.selectAllWrapper}>
          <Button
            size="smaller"
            color={isAllSelected ? 'translucent' : 'primary'}
            onClick={handleSelectAll}
            className={styles.selectAllButton}
          >
            <i className={buildClassName('icon', isAllSelected ? 'icon-close' : 'icon-check')} />
            {isAllSelected ? lang('DeselectAll') : lang('SelectAll')}
          </Button>
        </div>
      </div>
      
      <div className={styles.groupList}>
        {groupChats.length > 0 ? (
          groupChats.map(chat => {
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
        <strong>{(settings.monitoredChatIds || []).length}</strong> {lang('CustomerServiceGroupsSelected')}
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
          <div className={styles.addInputWrapper}>
            <Icon name="search" className={styles.inputIcon} />
            <InputText
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder={lang('CustomerServiceSearchUsers')}
              className={styles.addInput}
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
                          <span className={styles.resultUsername}>@{result.username}</span>
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
        
        <div className={styles.orDivider}>
          <span>{lang('Or')}</span>
        </div>
        
        <div className={styles.manualInput}>
          <div className={styles.addInputWrapper}>
            <Icon name="user-add" className={styles.inputIcon} />
            <InputText
              value={newUserId}
              onChange={handleUserId}
              placeholder={lang('CustomerServiceAddUserIdPlaceholder')}
              className={styles.addInput}
            />
          </div>
          <div className={styles.addWrapper}>
            <Button
              size="smaller"
              color="primary"
              onClick={handleAddUserId}
              disabled={!newUserId.trim()}
              className={styles.addButton}
            >
              <Icon name="add" />
              {lang('Add')}
            </Button>
          </div>
        </div>
      </div>
      
      {(settings.filteredUserIds || []).length > 0 ? (
        <div className={styles.filterList}>
          {(settings.filteredUserIds || []).map(userId => {
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
                        <span className={styles.userUsername}>@{userInfo.username}</span>
                      )}
                    </div>
                  </div>
                </div>
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
      const isAlreadyAdded = (settings.regexFilters || []).some(existingRegex => existingRegex.source === pattern);
      
      if (!isAlreadyAdded) {
        setSettings(prev => ({
          ...prev,
          regexFilters: [...(prev.regexFilters || []), regex]
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
        <div className={styles.inputGroup}>
          <div className={styles.addInputWrapper}>
            <Icon name="code" className={styles.inputIcon} />
            <InputText
              value={newRegexFilter}
              onChange={handleRegexFilter}
              placeholder={lang('CustomerServiceRegexPlaceholder')}
              className={styles.addInput}
              error={regexValidationError}
            />
          </div>
          <div className={styles.addRexWrapper}>
            <Button
              size="smaller"
              color="primary"
              onClick={handleAddRegexFilter}
              disabled={!newRegexFilter.trim() || !!regexValidationError}
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
      
      <div className={styles.presetSection}>
        <h4 className={styles.presetTitle}>
          <Icon name="star" className={styles.presetIcon} />
          Quick Add Common Rules:
        </h4>
        <div className={styles.presetButtons}>
          {presetRegexRules.map((rule, index) => {
            const isAlreadyAdded = (settings.regexFilters || []).some(regex => regex.source === rule.pattern);
            return (
              <Button
                key={index}
                size="tiny"
                color={isAlreadyAdded ? 'translucent' : 'secondary'}
                onClick={() => handleAddPresetRegex(rule.pattern)}
                disabled={isAlreadyAdded}
                className={styles.presetButton}
                title={rule.description}
              >
                <code>{rule.pattern}</code>
              </Button>
            );
          })}
        </div>
      </div>
      
      {(settings.regexFilters || []).length > 0 ? (
        <div className={styles.filterList}>
          {(settings.regexFilters || []).map((regex, index) => {
            // 查找匹配的预设规则描述
            const presetRule = presetRegexRules.find(rule => rule.pattern === regex.source);
            
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
          {lang('CustomerServiceRegexExamples')}:
        </h4>
        <ul>
          <li><code>^/\w+</code> - {lang('CustomerServiceRegexExample1')}</li>
          <li><code>^@\w+</code> - {lang('CustomerServiceRegexExample2')}</li>
          <li><code>^\[系统\]</code> - {lang('CustomerServiceRegexExample3')}</li>
          <li><code>bot$</code> - {lang('CustomerServiceRegexExample4')}</li>
        </ul>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className={styles.modal}
      dialogStyle="width: 95vw !important; height: 95vh !important; max-width: 95vw !important; max-height: 95vh !important; margin: 0; border-radius: 0; top: 0; left: 0; right: 0; bottom: 0;"
      title={
        <span className={styles.modalTitle}>
          <Icon name="settings" className={styles.titleIcon} />
          {lang('CustomerServiceSettings')}
        </span>
      }
    >
      <div className={styles.settingsModal}>
        <div className={styles.tabContainer}>
          <TabList
            tabs={tabs}
            activeTab={activeTab}
            onSwitchTab={setActiveTab}
            className={styles.tabs}
          />
        </div>
        
        <div className={styles.content}>
          {activeTab === 0 && renderGroupFilters()}
          {activeTab === 1 && renderUserFilters()}
          {activeTab === 2 && renderMessageFilters()}
        </div>
        
        <div className={styles.footer}>
          <div className={styles.compactSettings}>
            <div className={styles.settingGroup}>
              <label className={styles.settingLabel} title={lang('CustomerServiceOnCallModeDescription')}>
                <Icon name="phone" className={styles.settingIcon} />
                {lang('CustomerServiceOnCallMode')}
              </label>
              <input
                type="radio"
                name="customerServiceMode"
                checked={settings.mode === 'oncall'}
                onChange={() => handleModeChange('oncall')}
                className={styles.compactRadio}
              />
            </div>

            <div className={styles.settingGroup}>
              <label className={styles.settingLabel} title={lang('CustomerServiceAssistModeDescription')}>
                <Icon name="hand" className={styles.settingIcon} />
                {lang('CustomerServiceAssistMode')}
              </label>
              <input
                type="radio"
                name="customerServiceMode"
                checked={settings.mode === 'assist'}
                onChange={() => handleModeChange('assist')}
                className={styles.compactRadio}
              />
            </div>

            <div className={styles.settingGroup}>
              <label className={styles.settingLabel} title={lang('CustomerServiceAutoReadDescription')}>
                <Icon name="check-circle" className={styles.settingIcon} />
                {lang('CustomerServiceAutoRead')}
              </label>
              <Checkbox
                checked={settings.autoRead || false}
                onChange={(e) => handleAutoReadChange(e.currentTarget.checked)}
                className={styles.compactCheckbox}
              />
            </div>
          </div>

          <div className={styles.footerActions}>
            <div>
              <Button
                  size="smaller"
                  color="translucent"
                  onClick={handleReset}
                  className={styles.resetButton}
              >
                <Icon name="restart" />
                {lang('CustomerServiceResetSettings')}
              </Button>
            </div>
            <div>
              <Button
                size="smaller"
                className={styles.closeButton}
                color="translucent"
                onClick={() => {
                  setSelectedTagId('-1'); // 重置筛选
                  onClose();
                }}
              >
                <Icon name="close" />
                {lang('CustomerServiceCancel')}
              </Button>
            </div>
            <div>
              <Button
                size="smaller"
                color="primary"
                onClick={handleSave}
                className={styles.saveButton}
              >
                <Icon name="check" />
                {lang('CustomerServiceSaveSettings')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>((global): StateProps => {
  const chats = global.chats.byId;
  const users = global.users.byId;
  const {
    byId: chatFolders,
    orderedIds: orderedFolderIds,
  } = global.chatFolders || {};
  const savedSettings = selectCustomerServiceSettings(global);

  return {
    chats,
    users,
    chatFolders: chatFolders || {},
    orderedFolderIds,
    savedSettings,
  };
})(CustomerServiceSettings));
