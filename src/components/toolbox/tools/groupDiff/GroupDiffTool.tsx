import type { FC } from '../../../../lib/teact/teact';
import {
  memo, useCallback, useMemo, useState,
} from '../../../../lib/teact/teact';
import { withGlobal } from '../../../../global';

import type { ApiChat, ApiUser } from '../../../../api/types';

import {
  getUserFullName,
  isChatChannel,
  isChatSuperGroup,
} from '../../../../global/helpers';
import { getRawPeerId } from '../../../../util/entities/ids';
import { callApi } from '../../../../api/gramjs';

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
  const selectedSourceUser = sourceUserId ? usersById[sourceUserId] : undefined;
  const selectedTargetUser = targetUserId ? usersById[targetUserId] : undefined;

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

      <div className={styles.actions}>
        <Button
          size="smaller"
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

              const showRankTag = hasActivityRanking && typeof group.rank === 'number';
              const showScoreTag = hasActivityRanking && (group.score ?? 0) > 0;

              return (
                <div key={group.chatId} className={styles.resultItem}>
                  <div className={styles.resultDetails}>
                    <div className={styles.resultTitleRow}>
                      <div className={styles.resultTitle}>{group.title}</div>
                      {(showRankTag || showScoreTag) && (
                        <div className={styles.tagRow}>
                          {showRankTag && <span className={styles.rankTag}>#{group.rank}</span>}
                          {showScoreTag && <span className={styles.scoreTag}>活跃度{group.score}</span>}
                        </div>
                      )}
                    </div>
                    <div className={styles.resultMeta}>
                      <span>ID:{group.chatId}</span>
                      {group.alias && <span>别名:{group.alias}</span>}
                    </div>
                  </div>
                  <div className={styles.resultActions}>
                    <div className={styles.actionButtons}>
                      {activeTab === 0 && (
                        <>
                          <Button
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
                        </>
                      )}
                      {activeTab === 1 && (
                        <>
                          {!useMyGroups && (
                            <Button
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
                      {(inviteA === 'success' || inviteB === 'success') && <span className={styles.successText}>已发送邀请</span>}
                      {(removeA === 'success' || removeB === 'success') && <span className={styles.successText}>已移出成员</span>}
                      {inviteA === 'error' && <span className={styles.errorText}>A 邀请失败</span>}
                      {inviteB === 'error' && <span className={styles.errorText}>B 邀请失败</span>}
                      {removeA === 'error' && <span className={styles.errorText}>A 移除失败</span>}
                      {removeB === 'error' && <span className={styles.errorText}>B 移除失败</span>}
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
