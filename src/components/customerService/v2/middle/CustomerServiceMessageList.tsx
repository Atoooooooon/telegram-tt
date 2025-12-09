import type { FC } from '../../../../lib/teact/teact';

import { memo, useCallback, useMemo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import { MAIN_THREAD_ID } from '../../../../api/types';
import type { ObserveFn } from '../../../../hooks/useIntersectionObserver';
import type { CustomerServiceMessageGroup } from '../../../../global/types/customerServiceV2';

import {
  selectCustomerServiceV2ContextChatId,
  selectCustomerServiceV2ContextMessageId,
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2Messages,
} from '../../../../global/selectors/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import {
  DEFAULT_GROUPING_WINDOW,
  groupCustomerServiceMessages,
} from '../helpers/groupCustomerServiceMessages';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Icon from '../../../common/icons/Icon';
import Message from '../../../middle/message/Message';
import Button from '../../../ui/Button';
import CustomerServiceSourceBadge from '../shared/CustomerServiceSourceBadge';

import styles from './CustomerServiceMessageList.module.scss';

type OwnProps = {
  className?: string;
};

type StateProps = {
  messages: ApiMessage[];
  messageCount: number;
  activeContextChatId?: string;
  activeContextMessageId?: number;
};

const CustomerServiceMessageList: FC<OwnProps & StateProps> = ({
  className,
  messages,
  messageCount,
  activeContextChatId,
  activeContextMessageId,
}) => {
  const {
    removeFromCustomerServiceV2,
    openChat,
    focusMessage,
    setCustomerServiceV2Context,
    updateDraftReplyInfo,
  } = getActions();
  const lang = useLang();

  const handleRemoveMessage = useLastCallback((chatId: string, messageId: number) => {
    removeFromCustomerServiceV2({ chatId, messageId, tabId: getCurrentTabId() });
  });

  const handleViewContext = useLastCallback((chatId: string, messageId: number) => {
    setCustomerServiceV2Context({
      chatId,
      messageId,
      tabId: getCurrentTabId(),
    });

    openChat({
      id: chatId,
      isHalfScreen: true,
      tabId: getCurrentTabId(),
    });

    // Focus on specific message after chat loads and mark it as reply target
    setTimeout(() => {
      focusMessage({
        chatId,
        messageId,
        isHalfScreen: true,
        tabId: getCurrentTabId(),
      });

      updateDraftReplyInfo({
        replyToMsgId: messageId,
        tabId: getCurrentTabId(),
      });
    }, 300);
  });

  const observeIntersectionForLoading = useCallback<ObserveFn>((element, targetCallback) => {
    if (targetCallback) {
      targetCallback({
        isIntersecting: true,
        intersectionRatio: 1,
        target: element,
      } as unknown as IntersectionObserverEntry);
    }

    return () => undefined;
  }, []);

  const messageGroups = useMemo<CustomerServiceMessageGroup[]>(() => {
    if (!messages.length) {
      return [];
    }

    return groupCustomerServiceMessages(messages, DEFAULT_GROUPING_WINDOW);
  }, [messages]);

  // Performance optimization: Memoize message rendering threshold
  const hasLargeMessageCount = useMemo(() => messageCount > 1000, [messageCount]);

  if (messageCount === 0) {
    return (
      <div className={buildClassName(styles.emptyState, className)}>
        <div className={styles.emptyIcon}>
          <Icon name="animals" />
        </div>
        <h3 className={styles.emptyTitle}>
          {lang('CustomerServiceEmpty')}
        </h3>
        <p className={styles.emptyHint}>
          {lang('CustomerServiceEmptyHint')}
        </p>
      </div>
    );
  }

  // Render message group
  const renderMessageGroup = useCallback((group: CustomerServiceMessageGroup) => {
    const handleRemoveGroup = () => {
      group.messages.forEach((msg) => {
        handleRemoveMessage(msg.chatId, msg.id);
      });
    };

    const handleViewGroupContext = () => {
      const firstMessage = group.messages[0];
      handleViewContext(firstMessage.chatId, firstMessage.id);
    };

    const isActiveGroup = activeContextChatId === group.chatId
      && group.messages.some((msg) => msg.id === activeContextMessageId);

    return (
      <div
        key={group.id}
        className={buildClassName(
          styles.messageGroup,
          isActiveGroup && styles.activeContext,
        )}
      >
        <div className={styles.groupHeader}>
          <CustomerServiceSourceBadge
            message={group.messages[0]}
            className={buildClassName(styles.sourceBadge, styles.sourceBadgeInteractive)}
            onClick={handleViewGroupContext}
          />
          <span className={styles.groupMessageCount}>
            {lang('CustomerServiceGroupMessageCount', { count: group.messageCount })}
          </span>
          <Button
            className={styles.groupRemoveButton}
            round
            size="tiny"
            color="translucent"
            onClick={(e) => {
              e.stopPropagation();
              handleRemoveGroup();
            }}
            ariaLabel={lang('RemoveFromCustomerService')}
          >
            <i className="icon icon-close" />
          </Button>
        </div>
        <div className={styles.groupMessages}>
          {group.messages.map((message, msgIndex) => (
            <div
              key={`${message.chatId}-${message.id}`}
              className={styles.groupedMessage}
              onClick={(e) => {
                if (e.defaultPrevented) return;
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                if (target.closest('button') || target.closest('a')) return;
                const selection = window.getSelection && window.getSelection();
                if (selection && selection.toString()) return;
                e.preventDefault();
                e.stopPropagation();
                handleViewContext(message.chatId, message.id);
              }}
            >
              <Message
                message={message}
                threadId={message.chatId}
                messageListType="thread"
                noComments
                noReplies
                observeIntersectionForLoading={observeIntersectionForLoading}
                appearanceOrder={msgIndex}
                isJustAdded={false}
                isFirstInGroup={msgIndex === 0}
                isLastInGroup={msgIndex === group.messages.length - 1}
                isFirstInDocumentGroup={false}
                isLastInDocumentGroup={false}
                isLastInList={false}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }, [activeContextChatId, activeContextMessageId, handleRemoveMessage, handleViewContext, lang, observeIntersectionForLoading]);

  return (
    <div className={buildClassName(styles.root, className)}>
      {hasLargeMessageCount && (
        <div className={styles.performanceHint}>
          <i className="icon icon-info" />
          <span>{lang('CustomerServicePerformanceHint', { count: messageCount })}</span>
        </div>
      )}
      <div className={styles.messageList}>
        {messageGroups.map((group) => renderMessageGroup(group))}
      </div>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const tabId = getCurrentTabId();
    const messages = selectCustomerServiceV2Messages(global, tabId);
    const messageCount = selectCustomerServiceV2MessageCount(global, tabId);
    const activeContextChatId = selectCustomerServiceV2ContextChatId(global, tabId);
    const activeContextMessageId = selectCustomerServiceV2ContextMessageId(global, tabId);

    return {
      messages,
      messageCount,
      activeContextChatId,
      activeContextMessageId,
    };
  })(CustomerServiceMessageList),
);
