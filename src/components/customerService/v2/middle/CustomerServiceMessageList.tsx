import type { FC } from '../../../../lib/teact/teact';
import type React from '../../../../lib/teact/teact';

import { memo, useCallback, useMemo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';
import type { ObserveFn } from '../../../../hooks/useIntersectionObserver';
import type { IAlbum } from '../../../../types';

import {
  selectCustomerServiceV2ContextChatId,
  selectCustomerServiceV2ContextMessageId,
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2Messages,
} from '../../../../global/selectors/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import { groupMessages, isAlbum as isAlbumEntry } from '../../../middle/helpers/groupMessages';

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
  const { removeFromCustomerServiceV2, openChat, focusMessage } = getActions();
  const lang = useLang();

  const handleRemoveMessage = useLastCallback((chatId: string, messageId: number) => {
    removeFromCustomerServiceV2({ chatId, messageId, tabId: getCurrentTabId() });
  });

  const handleViewContext = useLastCallback((chatId: string, messageId: number) => {
    openChat({
      id: chatId,
      isHalfScreen: true,
      tabId: getCurrentTabId(),
    });

    // Focus on specific message after chat loads
    setTimeout(() => {
      focusMessage({
        chatId,
        messageId,
        isHalfScreen: true,
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
      } as IntersectionObserverEntry);
    }

    return () => undefined;
  }, []);

  const messageEntries = useMemo<(ApiMessage | IAlbum)[]>(() => {
    if (!messages.length) {
      return [];
    }

    const groupedMessages = groupMessages(messages);
    const flattened: (ApiMessage | IAlbum)[] = [];

    groupedMessages.forEach((dateGroup) => {
      dateGroup.senderGroups.forEach((senderGroup) => {
        senderGroup.forEach((item) => {
          flattened.push(item);
        });
      });
    });

    return flattened;
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

  return (
    <div className={buildClassName(styles.root, className)}>
      {hasLargeMessageCount && (
        <div className={styles.performanceHint}>
          <i className="icon icon-info" />
          <span>{lang('CustomerServicePerformanceHint', { count: messageCount })}</span>
        </div>
      )}
      <div className={styles.messageList}>
        {messageEntries.map((messageOrAlbum, index) => {
          const album = isAlbumEntry(messageOrAlbum) ? messageOrAlbum : undefined;
          const message = album ? album.mainMessage : messageOrAlbum as ApiMessage;
          const containsContextMessage = activeContextMessageId !== undefined
            ? album
              ? album.messages.some((albumMessage) => albumMessage.id === activeContextMessageId)
              : activeContextMessageId === message.id
            : false;
          const isActiveContext = activeContextChatId === message.chatId && containsContextMessage;
          const key = album
            ? `cs-msg-${message.chatId}-album-${album.albumId}`
            : `cs-msg-${message.chatId}-${message.id}-${index}`;

          const messageContentClassName = buildClassName(
            styles.messageContent,
            styles.messageContentInteractive,
          );

          const handleContextNavigation = (targetMessageId: number) => {
            handleViewContext(message.chatId, targetMessageId);
          };

          const handleContentClickCapture = (event: React.MouseEvent<HTMLDivElement>) => {
            if (event.defaultPrevented) {
              return;
            }

            if (event.button !== 0) {
              return;
            }

            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }

            const target = event.target as HTMLElement;
            if (
              target.closest(`.${styles.messageActions}`)
              || target.closest('button')
              || target.closest('a')
              || target.closest('[data-prevent-cs-context]')
            ) {
              return;
            }

            const selection = window.getSelection && window.getSelection();
            if (selection && selection.toString()) {
              return;
            }

            const messageElement = target.closest<HTMLElement>('[data-message-id]');
            const targetMessageId = messageElement?.dataset.messageId
              ? Number(messageElement.dataset.messageId)
              : message.id;

            if (Number.isNaN(targetMessageId)) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            handleContextNavigation(targetMessageId);
          };

          return (
            <div
              key={key}
              className={buildClassName(
                styles.messageWrapper,
                isActiveContext && styles.activeContext,
              )}
            >
              <CustomerServiceSourceBadge
                message={message}
                className={buildClassName(styles.sourceBadge, styles.sourceBadgeInteractive)}
                onClick={() => handleContextNavigation(message.id)}
              />
              <div
                className={messageContentClassName}
                onClickCapture={handleContentClickCapture}
              >
                <Message
                  message={message}
                  album={album}
                  threadId={message.chatId}
                  messageListType="thread"
                  noComments
                  noReplies
                  observeIntersectionForLoading={observeIntersectionForLoading}
                  appearanceOrder={index}
                  isJustAdded={false}
                  isFirstInGroup={false}
                  isLastInGroup={false}
                  isFirstInDocumentGroup={false}
                  isLastInDocumentGroup={false}
                  isLastInList={false}
                  onMetaClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleContextNavigation(message.id);
                  }}
                />
                <div className={styles.messageActions}>
                  <Button
                    className={styles.actionButton}
                    round
                    size="tiny"
                    color="translucent"
                    onClick={() => {
                      if (album) {
                        album.messages.forEach((albumMessage) => {
                          handleRemoveMessage(albumMessage.chatId, albumMessage.id);
                        });
                      } else {
                        handleRemoveMessage(message.chatId, message.id);
                      }
                    }}
                    ariaLabel={lang('RemoveFromCustomerService')}
                  >
                    <i className="icon icon-close" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
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
