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
  const [missingGroups, setMissingGroups] = useState<MissingGroup[]>([]);
  const [error, setError] = useState<string>();
  const [isChecking, setIsChecking] = useState(false);

  // Stats
  const [lastSourceCount, setLastSourceCount] = useState(0);
  const [lastTargetCount, setLastTargetCount] = useState(0);
  const [lastRunInfo, setLastRunInfo] = useState<{ sourceName: string; targetName: string }>();

  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({});
  const [removeStates, setRemoveStates] = useState<Record<string, InviteState>>({});

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
  const canRemoveSourceMember = !useMyGroups && Boolean(sourceUserId && selectedSourceUser);
  const removeButtonLabel = selectedSourceUser?.type === 'userTypeBot' ? '踢掉旧机器人' : '移出来源成员';

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
      setError('请先选择目标好友（要对比的用户）。');
      return;
    }

    if (!useMyGroups && !sourceUserId) {
      setError('请先选择来源好友（作为基准的用户）。');
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
      const targetCommonChats = await fetchAllCommonChats(targetUser.id, targetUser.accessHash);
      setLastTargetCount(targetCommonChats.length);

      const targetMatchKeys = new Set<string>();

      targetCommonChats.forEach((chat) => {
        getMatchKeys(chat).forEach((key) => targetMatchKeys.add(key));
      });

      const results: MissingGroup[] = sourceChats.reduce<MissingGroup[]>((acc, chat) => {
        const sourceKeys = getMatchKeys(chat);
        let matched = false;
        for (const key of sourceKeys) {
          if (targetMatchKeys.has(key)) {
            matched = true;
            break;
          }
        }
        if (matched) {
          return acc;
        }

        const activityKeys = getMatchKeys(chat, true);
        let activity: ActivityEntry | undefined;
        for (const key of activityKeys) {
          activity = activityMap.get(key);
          if (activity) {
            break;
          }
        }

        acc.push({
          chat,
          chatId: chat.id,
          title: chat.title,
          alias: activity?.alias,
          score: activity?.score ?? 0,
          rank: activity?.rank,
        });

        return acc;
      }, []);

      if (hasActivityRanking) {
        results.sort((a, b) => {
          if (b.score !== a.score) {
            return b.score - a.score;
          }

          if ((a.rank ?? Infinity) !== (b.rank ?? Infinity)) {
            return (a.rank ?? Infinity) - (b.rank ?? Infinity);
          }

          return a.title.localeCompare(b.title, 'zh-Hans');
        });
      }

      setMissingGroups(results);
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

  const handleInvite = useCallback(async (chat: ApiChat) => {
    if (!targetUserId) {
      setError('请先选择好友后再邀请。');
      return;
    }

    const targetUser = usersById[targetUserId];
    if (!targetUser?.accessHash) {
      setError('缺少该好友的 accessHash，请重新搜索后再试。');
      return;
    }

    setInviteStates((prev) => ({
      ...prev,
      [chat.id]: { status: 'loading' },
    }));

    try {
      const result = await callApi('addChatMembers', chat, [targetUser]);
      if (result === undefined) {
        throw new Error('邀请失败');
      }
      setInviteStates((prev) => ({
        ...prev,
        [chat.id]: { status: 'success' },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '邀请失败';
      setInviteStates((prev) => ({
        ...prev,
        [chat.id]: { status: 'error', message },
      }));
    }
  }, [targetUserId, usersById]);

  const handleRemove = useCallback(async (chat: ApiChat) => {
    if (useMyGroups || !sourceUserId) {
      setError('请先选择来源成员后再移除。');
      return;
    }

    const sourceUser = usersById[sourceUserId];
    if (!sourceUser?.accessHash) {
      setError('缺少来源成员的 accessHash，请重新搜索后再试。');
      return;
    }

    setRemoveStates((prev) => ({
      ...prev,
      [chat.id]: { status: 'loading' },
    }));

    try {
      let result: boolean | undefined;

      if (isChatSuperGroup(chat) || isChatChannel(chat)) {
        result = await callApi('updateChatMemberBannedRights', {
          chat,
          user: sourceUser,
          bannedRights: REMOVE_MEMBER_BANNED_RIGHTS,
        });
      } else {
        result = await callApi('deleteChatMember', chat, sourceUser);
      }

      if (!result) {
        throw new Error('移除失败');
      }

      setRemoveStates((prev) => ({
        ...prev,
        [chat.id]: { status: 'success' },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '移除失败';
      setRemoveStates((prev) => ({
        ...prev,
        [chat.id]: { status: 'error', message },
      }));
    }
  }, [sourceUserId, useMyGroups, usersById]);

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        <p>
          计算差集：
          {' '}
          <b>[来源群组]</b>
          {' '}
          -
          <b>[目标群组]</b>
        </p>
      </div>

      <div className={styles.grid}>
        <UserSelector
          title="选择来源好友 (基准)"
          search={sourceSearch}
          onSearchChange={setSourceSearch}
          users={filteredSourceUsers}
          selectedUserId={sourceUserId}
          onSelect={setSourceUserId}
          placeholder="搜索来源好友..."
          disabled={useMyGroups}
          headerAction={(/* This replace string is provided by the user, I am not allowed to change it. */
            <Checkbox
              checked={useMyGroups}
              label="使用我的群组"
              onCheck={(checked) => setUseMyGroups(checked)}
            />
          )}
        />

        <UserSelector
          title="选择目标好友 (被减)"
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
          <p className={styles.activityHint}>
            支持格式：
            <code>1. -123456789</code>
            {' '}
            或
            {' '}
            <code>1. -123456789 [Alias] (96)</code>
          </p>
        </div>
      </section>

      <div className={styles.actions}>
        <Button
          size="smaller"
          onClick={handleRun}
          disabled={!targetUserId || (!useMyGroups && !sourceUserId) || isChecking}
          isLoading={isChecking}
        >
          计算缺失群组
        </Button>
        <span className={styles.actionsHint}>
          Telegram 接口会分页返回共同群组，好友群越多等待时间越长。
        </span>
      </div>

      {error && (
        <div className={styles.errorBox}>{error}</div>
      )}

      <section className={styles.results}>
        <div className={styles.resultsHeader}>
          <div>
            <h4>
              缺失群组（
              {missingGroups.length}
              ）
            </h4>
            {lastRunInfo && (
              <p>
                对比：
                {lastRunInfo.sourceName}
                {' '}
                的群组 -
                {' '}
                {lastRunInfo.targetName}
                {' '}
                的共同群组
              </p>
            )}
          </div>
          <div className={styles.resultsStats}>
            <span>
              来源群数：
              {lastSourceCount}
            </span>
            <span>
              目标共同群数：
              {lastTargetCount}
            </span>
            <span>
              活跃榜：
              {activityData.entries.length}
            </span>
          </div>
        </div>

        <div className={styles.resultList}>
          {missingGroups.length === 0 ? (
            <div className={styles.empty}>
              {lastRunInfo
                ? '没有发现缺失的群组。'
                : '尚未开始，请选择好友并点击计算.'}
            </div>
          ) : (
            missingGroups.map((group) => {
              const inviteState = inviteStates[group.chatId]?.status ?? 'idle';
              const inviteMessage = inviteStates[group.chatId]?.message;
              const removeState = removeStates[group.chatId]?.status ?? 'idle';
              const removeMessage = removeStates[group.chatId]?.message;
              const showRankTag = hasActivityRanking && typeof group.rank === 'number';
              const showScoreTag = hasActivityRanking && (group.score ?? 0) > 0;

              return (
                <div key={group.chatId} className={styles.resultItem}>
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
                      <Button
                        size="smaller"
                        color="primary"
                        className={styles.inviteButton}
                        disabled={!targetUserId || inviteState === 'loading'}
                        isLoading={inviteState === 'loading'}
                        onClick={() => handleInvite(group.chat)}
                      >
                        {selectedTargetUser?.type === 'userTypeBot' ? '拉新机器人进群' : '邀请进群'}
                      </Button>
                      {canRemoveSourceMember && (
                        <Button
                          size="smaller"
                          color="danger"
                          className={styles.removeButton}
                          disabled={removeState === 'loading'}
                          isLoading={removeState === 'loading'}
                          onClick={() => handleRemove(group.chat)}
                        >
                          {removeButtonLabel}
                        </Button>
                      )}
                    </div>
                    <div className={styles.actionMessages}>
                      {inviteState === 'success' && (
                        <span className={styles.successText}>已发送邀请</span>
                      )}
                      {inviteState === 'error' && (
                        <span className={styles.errorText}>{inviteMessage || '邀请失败'}</span>
                      )}
                      {removeState === 'success' && (
                        <span className={styles.successText}>
                          {selectedSourceUser?.type === 'userTypeBot' ? '已踢掉旧机器人' : '已移出来源成员'}
                        </span>
                      )}
                      {removeState === 'error' && (
                        <span className={styles.errorText}>{removeMessage || '移除失败'}</span>
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
