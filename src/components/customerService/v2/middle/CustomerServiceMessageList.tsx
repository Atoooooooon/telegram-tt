import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiMessage } from '../../../../api/types';

import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import {
  selectCustomerServiceV2Messages,
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2ContextChatId,
  selectCustomerServiceV2ContextMessageId,
} from '../../../../global/selectors/customerServiceV2';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';
import { useMemo } from '../../../../lib/teact/teact';

import CustomerServiceSourceBadge from '../shared/CustomerServiceSourceBadge';
import Message from '../../../middle/message/Message';
import Button from '../../../ui/Button';
import Icon from '../../../common/icons/Icon';
import Loading from '../../../ui/Loading';

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

  // Performance optimization: Memoize message rendering threshold
  const hasLargeMessageCount = useMemo(() => messageCount > 1000, [messageCount]);

  if (messageCount === 0) {
    return (
      <div className={buildClassName(styles.emptyState, className)}>
        <div className={styles.emptyIcon}>
          <Icon name='animals' />
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
        {messages.map((message, index) => {
          const isActiveContext = activeContextChatId === message.chatId
            && activeContextMessageId === message.id;

          return (
            <div
              key={`cs-msg-${message.chatId}-${message.id}-${index}`}
              className={buildClassName(
                styles.messageWrapper,
                isActiveContext && styles.activeContext,
              )}
            >
              <CustomerServiceSourceBadge
                message={message}
                className={styles.sourceBadge}
              />
              <div className={styles.messageContent}>
                <Message
                  message={message}
                  threadId={message.chatId}
                  messageListType="thread"
                  noComments
                  noReplies
                  appearanceOrder={index}
                  isJustAdded={false}
                  isFirstInGroup={false}
                  isLastInGroup={false}
                  isFirstInDocumentGroup={false}
                  isLastInDocumentGroup={false}
                  isLastInList={false}
                  onMetaClick={() => {alert('ready...');}}
                />
                <div className={styles.messageActions}>
                  <Button
                    className={styles.actionButton}
                    round
                    size="tiny"
                    color="translucent"
                    onClick={() => handleViewContext(message.chatId, message.id)}
                    ariaLabel={lang('ViewContext')}
                  >
                    <i className="icon icon-arrow-right" />
                  </Button>
                  <Button
                    className={styles.actionButton}
                    round
                    size="tiny"
                    color="translucent"
                    onClick={() => handleRemoveMessage(message.chatId, message.id)}
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
