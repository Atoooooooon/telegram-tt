import type { FC } from '../../../../lib/teact/teact';
import {
  memo, useCallback, useMemo, useState,
} from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiChat, ApiUser } from '../../../../api/types';

import {
  getUserFullName,
  isChatChannel,
  isChatSuperGroup,
} from '../../../../global/helpers';
import { getRawPeerId } from '../../../../util/entities/ids';
import { callApi } from '../../../../api/gramjs';
import { fetchTelegramBotIdentity, leaveChatAsBot } from './telegramBotApi';

import Button from '../../../ui/Button';
import Checkbox from '../../../ui/Checkbox';
import InputText from '../../../ui/InputText';
import TabList from '../../../ui/TabList';

import styles from './GroupDiffTool.module.scss';

type StateProps = {
  chatsById: Record<string, ApiChat>;
  usersById: Record<string, ApiUser>;
};

type ActivityEntry = {
  rank: number;
  chatId: string;
  comparableId?: string;
  alias?: string;
  score: number;
};

type MissingGroup = {
  chat: ApiChat;
  chatId: string;
  title: string;
  alias?: string;
  score: number;
  rank?: number;
};

type CommonChatsResponse = {
  chats: ApiChat[];
  nextMaxId?: string;
  count?: number;
};

type InviteState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

type TelegramBotState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  username?: string;
  message?: string;
};

const REMOVE_MEMBER_BANNED_RIGHTS = {
  viewMessages: true,
  sendMessages: true,
  sendMedia: true,
  sendStickers: true,
  sendGifs: true,
  sendGames: true,
  sendInline: true,
  embedLinks: true,
  sendPolls: true,
  changeInfo: true,
  inviteUsers: true,
  pinMessages: true,
  manageTopics: true,
  sendPhotos: true,
  sendVideos: true,
  sendRoundvideos: true,
  sendAudios: true,
  sendVoices: true,
  sendDocs: true,
  sendPlain: true,
} as const;

const activityRegex = /^\s*(\d+)\.\s*(-?\d+)(?:\s*\[(.+?)\])?(?:\s*\((\d+)\))?.*/;
const MAX_USER_SUGGESTIONS = 25;

function toComparableChatId(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return getRawPeerId(trimmed).toString();
  } catch {
    return undefined;
  }
}

function getMatchKeys(chat: Pick<ApiChat, 'id' | 'migratedTo'>, withComparableIds = false) {
  const keys = new Set<string>();

  const append = (chatId?: string) => {
    const trimmed = chatId?.trim();
    if (!trimmed) {
      return;
    }

    keys.add(trimmed);
    if (withComparableIds) {
      const comparableId = toComparableChatId(trimmed);
      if (comparableId) {
        keys.add(comparableId);
      }
    }
  };

  append(chat.id);
  append(chat.migratedTo?.chatId);

  return keys;
}

function parseActivityInput(raw: string) {
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const entries: ActivityEntry[] = [];
  let invalid = 0;

  lines.forEach((line) => {
    const match = line.match(activityRegex);
    if (!match) {
      invalid += 1;
      return;
    }

    const [, rankStr, chatId, alias, scoreStr] = match;
    const normalizedChatId = chatId.trim();
    if (!normalizedChatId) {
      invalid += 1;
      return;
    }

    entries.push({
      rank: Number(rankStr),
      chatId: normalizedChatId,
      comparableId: toComparableChatId(normalizedChatId),
      alias: alias?.trim(),
      score: scoreStr ? Number(scoreStr) : 0,
    });
  });

  return {
    entries,
    invalid,
  };
}

function getDisplayName(user?: ApiUser) {
  if (!user) {
    return undefined;
  }

  return getUserFullName(user)
    || user.usernames?.[0]?.username
    || (user.phoneNumber ? `+${user.phoneNumber}` : user.id);
}

const UserSelector: FC<{
  search: string;
  onSearchChange: (val: string) => void;
  users: Array<{ id: string; title: string; username?: string }>;
  selectedUserId?: string;
  onSelect: (id: string) => void;
  title: string;
  placeholder?: string;
  disabled?: boolean;
  headerAction?: React.ReactNode;
}> = ({
  search, onSearchChange, users, selectedUserId, onSelect, title, placeholder, disabled, headerAction,
}) => {
  return (
    <section className={`${styles.panel} ${disabled ? styles.panelDisabled : ''}`}>
      <div className={styles.panelHeader}>
        <h4>{title}</h4>
        {headerAction || (
          <span className={styles.panelHint}>
            最多展示
            {MAX_USER_SUGGESTIONS}
            {' '}
            条
          </span>
        )}
      </div>
      <div className={styles.panelBody}>
        <InputText
          value={search}
          placeholder={placeholder || '搜索联系人姓名、用户名或 ID'}
          onChange={(e) => onSearchChange(e.currentTarget.value)}
          disabled={disabled}
        />
        <div className={styles.userListWrapper}>
          <div className={styles.userList}>
            {!disabled && users.length === 0 && (
              <div className={styles.empty}>没有匹配的联系人，试试换个关键词。</div>
            )}
            {!disabled && users.map((user) => (
              <button
                key={user.id}
                type="button"
                className={`${styles.userItem} ${selectedUserId === user.id ? styles.userItemActive : ''}`}
                onClick={() => onSelect(user.id)}
              >
                <div className={styles.userName}>{user.title}</div>
                <div className={styles.userMeta}>
                  <span>
                    ID:
                    {user.id}
                  </span>
                  {user.username && (
                    <span>
                      @
                      {user.username}
                    </span>
                  )}
                </div>
              </button>
            ))}
            {disabled && (
              <div className={styles.empty}>当前使用“我的群组”作为对比源。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

const GroupDiffTool: FC<StateProps> = ({ chatsById, usersById }) => {
  const { showNotification } = getActions();
  const [useMyGroups, setUseMyGroups] = useState(true);

  // Target User (The one to invite / The one missing groups)
  const [targetSearch, setTargetSearch] = useState('');
  const [targetUserId, setTargetUserId] = useState<string>();

  // Source User (The one having groups) - Only when useMyGroups is false
  const [sourceSearch, setSourceSearch] = useState('');
  const [sourceUserId, setSourceUserId] = useState<string>();

  const [activityInput, setActivityInput] = useState('');
  const [onlyInSource, setOnlyInSource] = useState<MissingGroup[]>([]);
  const [onlyInTarget, setOnlyInTarget] = useState<MissingGroup[]>([]);
  const [bothInSourceAndTarget, setBothInSourceAndTarget] = useState<MissingGroup[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  const [error, setError] = useState<string>();
  const [isChecking, setIsChecking] = useState(false);

  // Stats
  const [lastSourceCount, setLastSourceCount] = useState(0);
  const [lastTargetCount, setLastTargetCount] = useState(0);
  const [lastRunInfo, setLastRunInfo] = useState<{ sourceName: string; targetName: string }>();

  const [inviteStates, setInviteStates] = useState<Record<string, Record<string, InviteState>>>({});
  const [removeStates, setRemoveStates] = useState<Record<string, Record<string, InviteState>>>({});
  const [botToken, setBotToken] = useState('');
  const [botState, setBotState] = useState<TelegramBotState>({ status: 'idle' });
  const [botLeaveStates, setBotLeaveStates] = useState<Record<string, InviteState>>({});
  const [selectedChatIds, setSelectedChatIds] = useState<Record<string, true>>({});
  const [isBatchLeaving, setIsBatchLeaving] = useState(false);

  const activityData = useMemo(() => parseActivityInput(activityInput), [activityInput]);
  const activityMap = useMemo(() => (
    activityData.entries.reduce((map, entry) => {
      const normalizedId = entry.chatId.trim();
      if (normalizedId) {
        map.set(normalizedId, entry);
      }
      if (entry.comparableId) {
        map.set(entry.comparableId, entry);
      }
      return map;
    }, new Map<string, ActivityEntry>())
  ), [activityData]);
  const hasActivityRanking = activityMap.size > 0;

  const groupChats = useMemo(() => (
    Object.values(chatsById).filter((chat) => (
      (chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup')
      && !chat.isNotJoined
      && !chat.isForbidden
    ))
  ), [chatsById]);

  const availableUsers = useMemo(() => (
    Object.values(usersById)
      .filter((user) => user.accessHash && !user.isSelf && user.type !== 'userTypeDeleted')
      .map((user) => ({
        id: user.id,
        accessHash: user.accessHash!,
        title: getUserFullName(user)
          || user.usernames?.[0]?.username
          || (user.phoneNumber ? `+${user.phoneNumber}` : '未命名联系人'),
        username: user.usernames?.[0]?.username,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans'))
  ), [usersById]);

  const filterUsers = useCallback((search: string) => {
    const trimmed = search.trim().toLowerCase();
    const list = trimmed
      ? availableUsers.filter((user) => (
        user.title.toLowerCase().includes(trimmed)
        || user.username?.toLowerCase().includes(trimmed)
        || user.id.toLowerCase().includes(trimmed)
      ))
      : availableUsers;
    return list.slice(0, MAX_USER_SUGGESTIONS);
  }, [availableUsers]);

  const filteredTargetUsers = useMemo(() => filterUsers(targetSearch), [filterUsers, targetSearch]);
  const filteredSourceUsers = useMemo(() => filterUsers(sourceSearch), [filterUsers, sourceSearch]);

  const fetchAllCommonChats = useCallback(async (userId: string, accessHash: string) => {
    const collected: ApiChat[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    let expectedCount: number | undefined;

    while (true) {
      const chunk = await callApi('getCommonChats', {
        userId,
        accessHash,
        maxId: cursor,
      }) as CommonChatsResponse | undefined;

      const chats = chunk?.chats || [];
      chats.forEach((chat) => {
        if (!seen.has(chat.id)) {
          seen.add(chat.id);
          collected.push(chat);
        }
      });

      if (chunk?.count !== undefined) {
        expectedCount = chunk.count;
      }

      if (!chunk?.nextMaxId || chats.length === 0 || chunk.nextMaxId === cursor) {
        break;
      }

      cursor = chunk.nextMaxId;
      if (expectedCount !== undefined && collected.length >= expectedCount) {
        break;
      }
    }

    return collected;
  }, []);

  const handleRun = useCallback(async () => {
    if (!targetUserId) {
      setError('请先选择目标好友。');
      return;
    }

    if (!useMyGroups && !sourceUserId) {
      setError('请先选择来源好友。');
      return;
    }

    const targetUser = usersById[targetUserId];
    if (!targetUser?.accessHash) {
      setError('缺少目标好友的 accessHash，请先和他聊过天或重新搜索。');
      return;
    }

    let sourceUser: ApiUser | undefined;
    if (!useMyGroups && sourceUserId) {
      sourceUser = usersById[sourceUserId];
      if (!sourceUser?.accessHash) {
        setError('缺少来源好友的 accessHash，请先和他聊过天或重新搜索。');
        return;
      }
    }

    setError(undefined);
    setIsChecking(true);

    try {
      // 1. Get Source Chats
      let sourceChats: ApiChat[];
      if (useMyGroups) {
        sourceChats = groupChats;
      } else {
        sourceChats = await fetchAllCommonChats(sourceUser!.id, sourceUser!.accessHash!);
      }
      setLastSourceCount(sourceChats.length);

      // 2. Get Target Chats (Common chats with ME)
      const targetChats = await fetchAllCommonChats(targetUser.id, targetUser.accessHash);
      setLastTargetCount(targetChats.length);

      const sourceMap = new Map<string, ApiChat>();
      sourceChats.forEach((chat) => {
        getMatchKeys(chat).forEach((key) => sourceMap.set(key, chat));
      });

      const targetMap = new Map<string, ApiChat>();
      targetChats.forEach((chat) => {
        getMatchKeys(chat).forEach((key) => targetMap.set(key, chat));
      });

      const toMissingGroup = (chat: ApiChat): MissingGroup => {
        const activityKeys = getMatchKeys(chat, true);
        let activity: ActivityEntry | undefined;
        for (const key of activityKeys) {
          activity = activityMap.get(key);
          if (activity) break;
        }
        return {
          chat,
          chatId: chat.id,
          title: chat.title,
          alias: activity?.alias,
          score: activity?.score ?? 0,
          rank: activity?.rank,
        };
      };

      const sortResults = (results: MissingGroup[]) => {
        if (!hasActivityRanking) {
          return results.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans'));
        }
        return results.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          if ((a.rank ?? Infinity) !== (b.rank ?? Infinity)) {
            return (a.rank ?? Infinity) - (b.rank ?? Infinity);
          }
          return a.title.localeCompare(b.title, 'zh-Hans');
        });
      };

      const onlySrc: MissingGroup[] = [];
      const onlyTgt: MissingGroup[] = [];
      const both: MissingGroup[] = [];

      sourceChats.forEach((chat) => {
        const keys = getMatchKeys(chat);
        let inTarget = false;
        for (const k of keys) {
          if (targetMap.has(k)) {
            inTarget = true;
            break;
          }
        }
        if (inTarget) both.push(toMissingGroup(chat));
        else onlySrc.push(toMissingGroup(chat));
      });

      targetChats.forEach((chat) => {
        const keys = getMatchKeys(chat);
        let inSource = false;
        for (const k of keys) {
          if (sourceMap.has(k)) {
            inSource = true;
            break;
          }
        }
        if (!inSource) onlyTgt.push(toMissingGroup(chat));
      });

      setOnlyInSource(sortResults(onlySrc));
      setOnlyInTarget(sortResults(onlyTgt));
      setBothInSourceAndTarget(sortResults(both));

      setInviteStates({});
      setRemoveStates({});
      setBotLeaveStates({});
      setSelectedChatIds({});
      setLastRunInfo({
        sourceName: useMyGroups ? '我' : (getDisplayName(sourceUser) || sourceUser!.id),
        targetName: getDisplayName(targetUser) || targetUser.id,
      });
    } catch (err: any) {
      setError(err?.message || '计算失败，请稍后重试。');
    } finally {
      setIsChecking(false);
    }
  }, [
    activityMap,
    fetchAllCommonChats,
    groupChats,
    hasActivityRanking,
    useMyGroups,
    sourceUserId,
    targetUserId,
    usersById,
  ]);

  const handleInvite = useCallback(async (chat: ApiChat, userId: string) => {
    const user = usersById[userId];
    if (!user?.accessHash) {
      setError('缺少好友的 accessHash，请重新搜索后再试。');
      return;
    }

    setInviteStates((prev) => ({
      ...prev,
      [chat.id]: {
        ...(prev[chat.id] || {}),
        [userId]: { status: 'loading' },
      },
    }));

    try {
      const result = await callApi('addChatMembers', chat, [user]);
      if (result === undefined) {
        throw new Error('邀请失败');
      }
      setInviteStates((prev) => ({
        ...prev,
        [chat.id]: {
          ...(prev[chat.id] || {}),
          [userId]: { status: 'success' },
        },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '邀请失败';
      setInviteStates((prev) => ({
        ...prev,
        [chat.id]: {
          ...(prev[chat.id] || {}),
          [userId]: { status: 'error', message },
        },
      }));
    }
  }, [usersById]);

  const handleRemove = useCallback(async (chat: ApiChat, userId: string) => {
    const user = usersById[userId];
    if (!user?.accessHash) {
      setError('缺少成员的 accessHash，请重新搜索后再试。');
      return;
    }

    setRemoveStates((prev) => ({
      ...prev,
      [chat.id]: {
        ...(prev[chat.id] || {}),
        [userId]: { status: 'loading' },
      },
    }));

    try {
      let result: boolean | undefined;

      if (isChatSuperGroup(chat) || isChatChannel(chat)) {
        result = await callApi('updateChatMemberBannedRights', {
          chat,
          user,
          bannedRights: REMOVE_MEMBER_BANNED_RIGHTS,
        });
      } else {
        result = await callApi('deleteChatMember', chat, user);
      }

      if (!result) {
        throw new Error('移除失败');
      }

      setRemoveStates((prev) => ({
        ...prev,
        [chat.id]: {
          ...(prev[chat.id] || {}),
          [userId]: { status: 'success' },
        },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '移除失败';
      setRemoveStates((prev) => ({
        ...prev,
        [chat.id]: {
          ...(prev[chat.id] || {}),
          [userId]: { status: 'error', message },
        },
      }));
    }
  }, [usersById]);

  const tabs = useMemo(() => [
    { id: 0, title: `仅 A 有 (${onlyInSource.length})` },
    { id: 1, title: `仅 B 有 (${onlyInTarget.length})` },
    { id: 2, title: `两者共有 (${bothInSourceAndTarget.length})` },
  ], [onlyInSource.length, onlyInTarget.length, bothInSourceAndTarget.length]);

  const currentResults = activeTab === 0 ? onlyInSource : activeTab === 1 ? onlyInTarget : bothInSourceAndTarget;
  const trimmedBotToken = botToken.trim();
  const selectedCurrentResults = useMemo(
    () => currentResults.filter((group) => selectedChatIds[group.chatId]),
    [currentResults, selectedChatIds],
  );
  const allCurrentResultsSelected = currentResults.length > 0
    && currentResults.every((group) => selectedChatIds[group.chatId]);

  const handleBotTokenChange = useCallback((value: string) => {
    setBotToken(value);
    setBotState({ status: 'idle' });
    setBotLeaveStates({});
  }, []);

  const handleVerifyBotToken = useCallback(async () => {
    if (!trimmedBotToken) {
      setError('请先输入 Bot Token。');
      return;
    }

    setError(undefined);
    setBotState({ status: 'loading' });

    try {
      const identity = await fetchTelegramBotIdentity(trimmedBotToken);
      setBotState({
        status: 'success',
        username: identity.username,
        message: identity.can_join_groups === false
          ? '该机器人被设置为不可加群，但仍可退出已加入的群。'
          : 'Token 校验通过。',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Token 校验失败';
      setBotState({ status: 'error', message });
    }
  }, [trimmedBotToken]);

  const handleToggleChatSelection = useCallback((chatId: string, checked: boolean) => {
    setSelectedChatIds((prev) => {
      if (checked) {
        return {
          ...prev,
          [chatId]: true,
        };
      }

      if (!prev[chatId]) {
        return prev;
      }

      const next = { ...prev };
      delete next[chatId];
      return next;
    });
  }, []);

  const handleToggleCurrentResults = useCallback((checked: boolean) => {
    setSelectedChatIds((prev) => {
      const next = { ...prev };

      currentResults.forEach((group) => {
        if (checked) {
          next[group.chatId] = true;
        } else {
          delete next[group.chatId];
        }
      });

      return next;
    });
  }, [currentResults]);

  const handleClearCurrentSelection = useCallback(() => {
    setSelectedChatIds((prev) => {
      const next = { ...prev };

      currentResults.forEach((group) => {
        delete next[group.chatId];
      });

      return next;
    });
  }, [currentResults]);

  const handleBotLeave = useCallback(async (chatId: string) => {
    if (!trimmedBotToken) {
      setError('请先输入 Bot Token。');
      return false;
    }

    setBotLeaveStates((prev) => ({
      ...prev,
      [chatId]: { status: 'loading' },
    }));

    try {
      await leaveChatAsBot(trimmedBotToken, chatId);
      setBotLeaveStates((prev) => ({
        ...prev,
        [chatId]: { status: 'success' },
      }));
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bot 退群失败';
      setBotLeaveStates((prev) => ({
        ...prev,
        [chatId]: { status: 'error', message },
      }));
      return false;
    }
  }, [trimmedBotToken]);

  const handleBatchBotLeave = useCallback(async () => {
    if (!trimmedBotToken) {
      setError('请先输入 Bot Token。');
      return;
    }

    if (selectedCurrentResults.length === 0) {
      setError('请先勾选需要退群的群组。');
      return;
    }

    setError(undefined);
    setIsBatchLeaving(true);

    let successCount = 0;
    let failedCount = 0;

    for (const group of selectedCurrentResults) {
      const isSuccess = await handleBotLeave(group.chatId);
      if (isSuccess) {
        successCount += 1;
      } else {
        failedCount += 1;
      }
    }

    setIsBatchLeaving(false);
    showNotification({
      message: failedCount > 0
        ? `Bot 批量退群完成，成功 ${successCount} 个，失败 ${failedCount} 个。`
        : `Bot 已退出 ${successCount} 个群组。`,
    });
  }, [handleBotLeave, selectedCurrentResults, showNotification, trimmedBotToken]);

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <p>
          差异对比：分析
          {' '}
          <b>[来源好友 A]</b>
          {' '}
          与
          {' '}
          <b>[目标好友 B]</b>
          {' '}
          的群组分布
        </p>
      </div>

      <div className={styles.grid}>
        <UserSelector
          title="来源好友 (A)"
          search={sourceSearch}
          onSearchChange={setSourceSearch}
          users={filteredSourceUsers}
          selectedUserId={sourceUserId}
          onSelect={setSourceUserId}
          placeholder="搜索来源好友..."
          disabled={useMyGroups}
          headerAction={(
            <Checkbox
              checked={useMyGroups}
              label="使用我的群组"
              onCheck={(checked) => setUseMyGroups(checked)}
            />
          )}
        />

        <UserSelector
          title="目标好友 (B)"
          search={targetSearch}
          onSearchChange={setTargetSearch}
          users={filteredTargetUsers}
          selectedUserId={targetUserId}
          onSelect={setTargetUserId}
          placeholder="搜索目标好友..."
        />
      </div>

      <div className={styles.secondaryGrid}>
        <section className={`${styles.panel} ${styles.activityPanel}`}>
          <div className={styles.panelHeader}>
            <h4>活跃度榜单 (可选)</h4>
            <span className={styles.panelHint}>用于排序结果</span>
          </div>
          <div className={styles.panelBody}>
            <textarea
              className={styles.textarea}
              value={activityInput}
              onChange={(e) => setActivityInput(e.currentTarget.value)}
              placeholder={'1. -4549167178 [TEST] (96)\n...'}
            />
            <div className={styles.activityStats}>
              <span>
                已解析
                {activityData.entries.length}
                {' '}
                条
              </span>
              {activityData.invalid > 0 && (
                <span className={styles.warning}>
                  忽略
                  {activityData.invalid}
                  {' '}
                  条
                </span>
              )}
            </div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.botPanel}`}>
          <div className={styles.panelHeader}>
            <h4>Bot Token 批量退群</h4>
            <span className={styles.panelHint}>前端直接调用 Telegram Bot API</span>
          </div>
          <div className={styles.panelBody}>
            <div className={styles.botFormRow}>
              <div className={styles.tokenInput}>
                <InputText
                  className={styles.tokenField}
                  label="Bot Token"
                  value={botToken}
                  placeholder="输入 Bot Token，例如 123456:AA..."
                  autoComplete="off"
                  onChange={(e) => handleBotTokenChange(e.currentTarget.value)}
                />
              </div>
              <Button
                inline
                size="smaller"
                color="secondary"
                className={styles.compactActionButton}
                onClick={handleVerifyBotToken}
                disabled={!trimmedBotToken || botState.status === 'loading'}
                isLoading={botState.status === 'loading'}
              >
                校验 Token
              </Button>
            </div>
            <div className={styles.botMetaRow}>
              <div className={styles.helpText}>
                这里调用的是 Bot API 的
                {' '}
                <code>leaveChat</code>
                ，机器人会主动退出群聊，不依赖踢人权限。
              </div>
              {botState.status === 'success' && (
                <span className={styles.statusTextSuccess}>
                  已连接
                  {botState.username ? ` @${botState.username}` : '该机器人'}
                  {botState.message ? `，${botState.message}` : ''}
                </span>
              )}
              {botState.status === 'error' && (
                <span className={styles.statusTextError}>{botState.message || 'Token 校验失败'}</span>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <Button
          inline
          size="smaller"
          className={styles.runButton}
          onClick={handleRun}
          disabled={!targetUserId || (!useMyGroups && !sourceUserId) || isChecking}
          isLoading={isChecking}
        >
          计算群组差异
        </Button>
        <span className={styles.actionsHint}>
          对比两人与我的共同群组，找出差异。
        </span>
      </div>

      {error && (
        <div className={styles.errorBox}>{error}</div>
      )}

      <section className={styles.results}>
        <div className={styles.resultsHeader}>
          <div>
            <h4>分析结果</h4>
            {lastRunInfo && (
              <p>
                A:
                {lastRunInfo.sourceName}
                {' '}
                | B:
                {lastRunInfo.targetName}
              </p>
            )}
          </div>
          <div className={styles.resultsStats}>
            <span>
              A 共：
              {lastSourceCount}
            </span>
            <span>
              B 共：
              {lastTargetCount}
            </span>
          </div>
        </div>

        <TabList tabs={tabs} activeTab={activeTab} onSwitchTab={setActiveTab} />

        <div className={styles.batchToolbar}>
          <Checkbox
            checked={allCurrentResultsSelected}
            label={`全选当前列表 (${selectedCurrentResults.length}/${currentResults.length})`}
            disabled={currentResults.length === 0}
            onCheck={handleToggleCurrentResults}
          />
          <div className={styles.batchActions}>
            <Button
              inline
              size="smaller"
              color="secondary"
              className={styles.compactActionButton}
              onClick={handleClearCurrentSelection}
              disabled={selectedCurrentResults.length === 0}
            >
              清空选择
            </Button>
            <Button
              inline
              size="smaller"
              color="danger"
              className={styles.compactActionButton}
              onClick={handleBatchBotLeave}
              disabled={!trimmedBotToken || selectedCurrentResults.length === 0 || isBatchLeaving}
              isLoading={isBatchLeaving}
            >
              Bot 批量退群
            </Button>
          </div>
        </div>

        <div className={styles.resultList}>
          {currentResults.length === 0 ? (
            <div className={styles.empty}>
              {lastRunInfo
                ? '该分类下没有群组。'
                : '尚未开始，请选择好友并点击计算.'}
            </div>
          ) : (
            currentResults.map((group) => {
              const inviteA = inviteStates[group.chatId]?.[sourceUserId!]?.status ?? 'idle';
              const inviteB = inviteStates[group.chatId]?.[targetUserId!]?.status ?? 'idle';
              const removeA = removeStates[group.chatId]?.[sourceUserId!]?.status ?? 'idle';
              const removeB = removeStates[group.chatId]?.[targetUserId!]?.status ?? 'idle';
              const botLeave = botLeaveStates[group.chatId]?.status ?? 'idle';

              const showRankTag = hasActivityRanking && typeof group.rank === 'number';
              const showScoreTag = hasActivityRanking && (group.score ?? 0) > 0;

              return (
                <div key={group.chatId} className={styles.resultItem}>
                  <label className={styles.selectToggle}>
                    <input
                      type="checkbox"
                      checked={Boolean(selectedChatIds[group.chatId])}
                      onChange={(e) => handleToggleChatSelection(group.chatId, e.currentTarget.checked)}
                    />
                  </label>
                  <div className={styles.resultDetails}>
                    <div className={styles.resultTitleRow}>
                      <div className={styles.resultTitle}>{group.title}</div>
                      {(showRankTag || showScoreTag) && (
                        <div className={styles.tagRow}>
                          {showRankTag && (
                            <span className={styles.rankTag}>
                              #
                              {group.rank}
                            </span>
                          )}
                          {showScoreTag && (
                            <span className={styles.scoreTag}>
                              活跃度
                              {group.score}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={styles.resultMeta}>
                      <span>
                        ID:
                        {group.chatId}
                      </span>
                      {group.alias && (
                        <span>
                          别名:
                          {group.alias}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className={styles.resultActions}>
                    <div className={styles.actionButtons}>
                      {activeTab === 0 && (
                        <>
                          <Button
                            inline
                            size="smaller"
                            color="primary"
                            className={styles.inviteButton}
                            disabled={inviteB === 'loading'}
                            isLoading={inviteB === 'loading'}
                            onClick={() => handleInvite(group.chat, targetUserId!)}
                          >
                            邀请 B 进群
                          </Button>
                          {!useMyGroups && (
                            <Button
                              inline
                              size="smaller"
                              color="danger"
                              className={styles.removeButton}
                              disabled={removeA === 'loading'}
                              isLoading={removeA === 'loading'}
                              onClick={() => handleRemove(group.chat, sourceUserId!)}
                            >
                              移出 A
                            </Button>
                          )}
                          <Button
                            inline
                            size="smaller"
                            color="danger"
                            className={styles.botLeaveButton}
                            disabled={botLeave === 'loading' || !trimmedBotToken}
                            isLoading={botLeave === 'loading'}
                            onClick={() => handleBotLeave(group.chatId)}
                          >
                            Bot 退群
                          </Button>
                        </>
                      )}
                      {activeTab === 1 && (
                        <>
                          {!useMyGroups && (
                            <Button
                              inline
                              size="smaller"
                              color="primary"
                              className={styles.inviteButton}
                              disabled={inviteA === 'loading'}
                              isLoading={inviteA === 'loading'}
                              onClick={() => handleInvite(group.chat, sourceUserId!)}
                            >
                              邀请 A 进群
                            </Button>
                          )}
                          <Button
                            inline
                            size="smaller"
                            color="danger"
                            className={styles.botLeaveButton}
                            disabled={botLeave === 'loading' || !trimmedBotToken}
                            isLoading={botLeave === 'loading'}
                            onClick={() => handleBotLeave(group.chatId)}
                          >
                            Bot 退群
                          </Button>
                          <Button
                            inline
                            size="smaller"
                            color="danger"
                            className={styles.removeButton}
                            disabled={removeB === 'loading'}
                            isLoading={removeB === 'loading'}
                            onClick={() => handleRemove(group.chat, targetUserId!)}
                          >
                            移出 B
                          </Button>
                        </>
                      )}
                      {activeTab === 2 && (
                        <>
                          {!useMyGroups && (
                            <Button
                              inline
                              size="smaller"
                              color="danger"
                              className={styles.removeButton}
                              disabled={removeA === 'loading'}
                              isLoading={removeA === 'loading'}
                              onClick={() => handleRemove(group.chat, sourceUserId!)}
                            >
                              移出 A
                            </Button>
                          )}
                          <Button
                            inline
                            size="smaller"
                            color="danger"
                            className={styles.botLeaveButton}
                            disabled={botLeave === 'loading' || !trimmedBotToken}
                            isLoading={botLeave === 'loading'}
                            onClick={() => handleBotLeave(group.chatId)}
                          >
                            Bot 退群
                          </Button>
                          <Button
                            inline
                            size="smaller"
                            color="danger"
                            className={styles.removeButton}
                            disabled={removeB === 'loading'}
                            isLoading={removeB === 'loading'}
                            onClick={() => handleRemove(group.chat, targetUserId!)}
                          >
                            移出 B
                          </Button>
                        </>
                      )}
                    </div>
                    <div className={styles.actionMessages}>
                      {(inviteA === 'success' || inviteB === 'success') && (
                        <span className={styles.successText}>已发送邀请</span>
                      )}
                      {(removeA === 'success' || removeB === 'success') && (
                        <span className={styles.successText}>已移出成员</span>
                      )}
                      {botLeave === 'success' && <span className={styles.successText}>Bot 已退群</span>}
                      {inviteA === 'error' && <span className={styles.errorText}>A 邀请失败</span>}
                      {inviteB === 'error' && <span className={styles.errorText}>B 邀请失败</span>}
                      {removeA === 'error' && <span className={styles.errorText}>A 移除失败</span>}
                      {removeB === 'error' && <span className={styles.errorText}>B 移除失败</span>}
                      {botLeave === 'error' && (
                        <span className={styles.errorText}>
                          {botLeaveStates[group.chatId]?.message || 'Bot 退群失败'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

export default memo(withGlobal<Record<string, never>>(
  (global): StateProps => ({
    chatsById: global.chats.byId,
    usersById: global.users.byId,
  }),
)(GroupDiffTool));
