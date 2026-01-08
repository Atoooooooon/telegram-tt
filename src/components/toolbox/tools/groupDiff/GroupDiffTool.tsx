import type { FC } from '../../../../lib/teact/teact';
import {
  memo, useCallback, useMemo, useState,
} from '../../../../lib/teact/teact';

import type { ApiChat, ApiUser } from '../../../../api/types';
import { callApi } from '../../../../api/gramjs';
import { withGlobal } from '../../../../global';
import { getUserFullName } from '../../../../global/helpers/users';
import Button from '../../../ui/Button';
import InputText from '../../../ui/InputText';
import styles from './GroupDiffTool.module.scss';

type StateProps = {
  chatsById: Record<string, ApiChat>;
  usersById: Record<string, ApiUser>;
};

type ActivityEntry = {
  rank: number;
  chatId: string;
  baseId: string;
  alias?: string;
  score: number;
};

type MissingGroup = {
  chatId: string;
  title: string;
  alias?: string;
  score: number;
  rank?: number;
};

type CommonChatsResponse = {
  chats: ApiChat[];
  nextMaxId?: string;
};

type InviteState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

const activityRegex = /^\s*(\d+)\.\s*(-?\d+)(?:\s*\[(.+?)\])?(?:\s*\((\d+)\))?.*/;
const MAX_USER_SUGGESTIONS = 25;

function extractBaseId(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.replace(/^-100/, '').replace(/^-/, '');
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
    const baseId = extractBaseId(chatId);
    if (!baseId) {
      invalid += 1;
      return;
    }

    entries.push({
      rank: Number(rankStr),
      chatId: chatId.trim(),
      baseId,
      alias: alias?.trim(),
      score: scoreStr ? Number(scoreStr) : 0,
    });
  });

  return {
    entries,
    invalid,
  };
}

const GroupDiffTool: FC<StateProps> = ({ chatsById, usersById }) => {
  const [friendSearch, setFriendSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>();
  const [activityInput, setActivityInput] = useState('');
  const [missingGroups, setMissingGroups] = useState<MissingGroup[]>([]);
  const [error, setError] = useState<string>();
  const [isChecking, setIsChecking] = useState(false);
  const [lastRunUserId, setLastRunUserId] = useState<string>();
  const [copiedChatId, setCopiedChatId] = useState<string>();
  const [fetchedCommonCount, setFetchedCommonCount] = useState(0);
  const [inviteStates, setInviteStates] = useState<Record<string, InviteState>>({});

  const activityData = useMemo(() => parseActivityInput(activityInput), [activityInput]);
  const activityMap = useMemo(() => (
    activityData.entries.reduce((map, entry) => {
      map.set(entry.baseId, entry);
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

  const filteredUsers = useMemo(() => {
    const search = friendSearch.trim().toLowerCase();
    const list = search
      ? availableUsers.filter((user) => (
        user.title.toLowerCase().includes(search)
        || user.username?.toLowerCase().includes(search)
        || user.id.toLowerCase().includes(search)
      ))
      : availableUsers;

    return list.slice(0, MAX_USER_SUGGESTIONS);
  }, [availableUsers, friendSearch]);

  const fetchAllCommonChats = useCallback(async (userId: string, accessHash: string) => {
    const collected: ApiChat[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;

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

      if (!chunk?.nextMaxId || chats.length === 0 || chunk.nextMaxId === cursor) {
        break;
      }

      cursor = chunk.nextMaxId;
    }

    return collected;
  }, []);

  const handleRun = useCallback(async () => {
    if (!selectedUserId) {
      setError('请先选择要对比的好友。');
      return;
    }

    const targetUser = usersById[selectedUserId];
    if (!targetUser?.accessHash) {
      setError('缺少该好友的 accessHash，请先和他聊过天或重新搜索。');
      return;
    }

    setError(undefined);
    setIsChecking(true);

    try {
      const commonChats = await fetchAllCommonChats(targetUser.id, targetUser.accessHash);
      setFetchedCommonCount(commonChats.length);

      const friendBaseIds = new Set<string>();
      commonChats.forEach((chat) => {
        const baseId = extractBaseId(chat.id);
        if (baseId) {
          friendBaseIds.add(baseId);
        }
      });

      const results: MissingGroup[] = groupChats.reduce<MissingGroup[]>((acc, chat) => {
        const baseId = extractBaseId(chat.id);
        if (!baseId || friendBaseIds.has(baseId)) {
          return acc;
        }

        const activity = activityMap.get(baseId);
        acc.push({
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
      setLastRunUserId(selectedUserId);
    } catch (err: any) {
      setError(err?.message || '请求共同群组失败，请稍后重试。');
    } finally {
      setIsChecking(false);
    }
  }, [activityMap, fetchAllCommonChats, groupChats, selectedUserId, usersById]);

  const handleCopy = useCallback((chatId: string) => {
    navigator.clipboard?.writeText(chatId).catch(() => undefined);
    setCopiedChatId(chatId);
    setTimeout(() => {
      setCopiedChatId(undefined);
    }, 1500);
  }, []);

  const handleInvite = useCallback(async (chatId: string) => {
    if (!selectedUserId) {
      setError('请先选择好友后再邀请。');
      return;
    }

    const targetUser = usersById[selectedUserId];
    if (!targetUser?.accessHash) {
      setError('缺少该好友的 accessHash，请重新搜索后再试。');
      return;
    }

    const chat = chatsById[chatId];
    if (!chat) {
      setError('找不到该群的信息，刷新后再试。');
      return;
    }

    setInviteStates((prev) => ({
      ...prev,
      [chatId]: { status: 'loading' },
    }));

    try {
      await callApi('addChatMembers', chat, [targetUser]);
      setInviteStates((prev) => ({
        ...prev,
        [chatId]: { status: 'success' },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '邀请失败';
      setInviteStates((prev) => ({
        ...prev,
        [chatId]: { status: 'error', message },
      }));
    }
  }, [chatsById, selectedUserId, usersById]);

  const summaryUser = lastRunUserId ? usersById[lastRunUserId] : undefined;

  return (
    <div className={styles.root}>
      <div className={styles.intro}>
        选择一个好友，粘贴活跃度榜单（固定格式），即可计算“我加入但他/她未加入”的群，并按活跃度排序。
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h4>选择好友（先添加好友私信）</h4>
            <span className={styles.panelHint}>最多展示 {MAX_USER_SUGGESTIONS} 条匹配结果</span>
          </div>
          <div className={styles.panelBody}>
            <InputText
              value={friendSearch}
              placeholder="搜索联系人姓名、用户名或 ID"
              onChange={(e) => setFriendSearch(e.currentTarget.value)}
            />
            <div className={styles.userListWrapper}>
              <div className={styles.userList}>
                {filteredUsers.length === 0 && (
                  <div className={styles.empty}>没有匹配的联系人，试试换个关键词。</div>
                )}
                {filteredUsers.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className={`${styles.userItem} ${selectedUserId === user.id ? styles.userItemActive : ''}`}
                    onClick={() => setSelectedUserId(user.id)}
                  >
                    <div className={styles.userName}>{user.title}</div>
                    <div className={styles.userMeta}>
                      <span>ID: {user.id}</span>
                      {user.username && <span>@{user.username}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <h4>活跃度榜单</h4>
            <span className={styles.panelHint}>例如：1. -4549167178 [TEST] (96)</span>
          </div>
          <div className={styles.panelBody}>
            <textarea
              className={styles.textarea}
              value={activityInput}
              onChange={(e) => setActivityInput(e.currentTarget.value)}
              placeholder={'1. -4549167178 [TEST] (96)\n2. -4604988776 (6)\n3. -936695322 [haowahaowa] (4)'}
            />
            <div className={styles.activityStats}>
              <span>已解析 {activityData.entries.length} 条</span>
              {activityData.invalid > 0 && (
                <span className={styles.warning}>忽略 {activityData.invalid} 条格式错误的行</span>
              )}
            </div>
            <p className={styles.activityHint}>
              支持格式：<code>1. -123456789</code> 或 <code>1. -123456789 [Alias] (96)</code>，别名与活跃度可选。
            </p>
          </div>
        </section>
      </div>

      <div className={styles.actions}>
        <Button
          size="smaller"
          onClick={handleRun}
          disabled={!selectedUserId || isChecking}
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
            <h4>缺失群组（{missingGroups.length}）</h4>
            {summaryUser && (
              <p>
                对比好友：{getUserFullName(summaryUser) || summaryUser.id}
              </p>
            )}
          </div>
          <div className={styles.resultsStats}>
            <span>我的群：{groupChats.length}</span>
            <span>好友共同群：{fetchedCommonCount}</span>
            <span>活跃榜：{activityData.entries.length}</span>
          </div>
        </div>

        <div className={styles.resultList}>
          {missingGroups.length === 0 ? (
            <div className={styles.empty}>
              {lastRunUserId
                ? '该好友已经加入了我当前账号的所有群。'
                : '尚未开始，先选择好友并粘贴榜单吧。'}
            </div>
          ) : (
            missingGroups.map((group) => {
              const inviteState = inviteStates[group.chatId]?.status ?? 'idle';
              const inviteMessage = inviteStates[group.chatId]?.message;
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
                            <span className={styles.rankTag}>#{group.rank}</span>
                          )}
                          {showScoreTag && (
                            <span className={styles.scoreTag}>活跃度 {group.score}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={styles.resultMeta}>
                      <span>ID: {group.chatId}</span>
                      {group.alias && <span>别名: {group.alias}</span>}
                    </div>
                  </div>
                  <div className={styles.resultActions}>
                    <Button
                      size="smaller"
                      color="secondary"
                      className={styles.copyButton}
                      onClick={() => handleCopy(group.chatId)}
                    >
                      {copiedChatId === group.chatId ? '已复制' : '复制 ID'}
                    </Button>
                    <Button
                      size="smaller"
                      color="primary"
                      className={styles.inviteButton}
                      disabled={!selectedUserId || inviteState === 'loading'}
                      isLoading={inviteState === 'loading'}
                      onClick={() => handleInvite(group.chatId)}
                    >
                      邀请进群
                    </Button>
                    {inviteState === 'success' && (
                      <span className={styles.successText}>已发送邀请</span>
                    )}
                    {inviteState === 'error' && (
                      <span className={styles.errorText}>{inviteMessage || '邀请失败'}</span>
                    )}
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

export default memo(withGlobal<{}>(
  (global): StateProps => ({
    chatsById: global.chats.byId,
    usersById: global.users.byId,
  }),
)(GroupDiffTool));
