import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { withGlobal } from '../../../../global';

import type { ApiChat, ApiMessage, ApiPeer } from '../../../../api/types';

import { getPeerFullTitle } from '../../../../global/helpers/peers';
import { selectChat } from '../../../../global/selectors';
import { selectSender } from '../../../../global/selectors/messages';
import buildClassName from '../../../../util/buildClassName';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Avatar from '../../../common/Avatar';

import styles from './CustomerServiceSourceBadge.module.scss';

type OwnProps = {
  message: ApiMessage;
  className?: string;
  onClick?: NoneToVoidFunction;
};

type StateProps = {
  chat?: ApiChat;
  sender?: ApiPeer;
};

const CustomerServiceSourceBadge: FC<OwnProps & StateProps> = ({
  chat,
  sender,
  className,
  onClick,
}) => {
  const lang = useLang();

  const chatTitle = chat?.title || lang('DeletedChat');
  const senderName = sender ? getPeerFullTitle(lang, sender) : lang('CustomerServiceUnknownUser');
  const isSenderSameAsChat = chat?.id === sender?.id;

  const displaySender = !isSenderSameAsChat ? senderName : undefined;
  const ariaLabel = displaySender
    ? lang('CustomerServiceFromChat', { chatName: chatTitle, senderName: displaySender })
    : lang('CustomerServiceFromChatChatOnly', { chatName: chatTitle });

  const avatarPeer = sender && !isSenderSameAsChat ? sender : chat;
  const handleKeyDown = useLastCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  });

  return (
    <div
      className={buildClassName(
        styles.root,
        onClick && styles.interactive,
        className,
      )}
      aria-label={ariaLabel}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {avatarPeer ? (
        <Avatar
          peer={avatarPeer}
          size="small"
          className={styles.avatar}
        />
      ) : (
        <div className={styles.deletedAvatar}>
          <span>?</span>
        </div>
      )}
      <div className={styles.info}>
        <span className={styles.chatName}>
          {chatTitle}
        </span>
        {displaySender && (
          <span className={styles.senderName}>
            {displaySender}
          </span>
        )}
      </div>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global, { message }): StateProps => {
    const chat = selectChat(global, message.chatId);
    const sender = selectSender(global, message);

    return {
      chat,
      sender,
    };
  })(CustomerServiceSourceBadge),
);
