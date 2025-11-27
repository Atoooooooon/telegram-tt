import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { ApiChat } from '../../../../api/types';

import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import { selectChat } from '../../../../global/selectors';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Avatar from '../../../common/Avatar';

import styles from './CustomerServiceSourceBadge.module.scss';

type OwnProps = {
  chatId: string;
  className?: string;
};

type StateProps = {
  chat?: ApiChat;
};

const CustomerServiceSourceBadge: FC<OwnProps & StateProps> = ({
  chatId,
  chat,
  className,
}) => {
  const { openChat } = getActions();
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    if (!chat) return;

    openChat({
      id: chatId,
      isHalfScreen: true,
      tabId: getCurrentTabId(),
    });
  });

  const chatTitle = chat?.title || lang('DeletedChat');

  return (
    <div
      className={buildClassName(styles.root, className)}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={lang('CustomerServiceFromChat', { chatName: chatTitle })}
    >
      {chat ? (
        <Avatar
          chat={chat}
          size="small"
          className={styles.avatar}
        />
      ) : (
        <div className={styles.deletedAvatar}>
          <span>?</span>
        </div>
      )}
      <span className={styles.chatName}>
        {chatTitle}
      </span>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global, { chatId }): StateProps => {
    const chat = selectChat(global, chatId);

    return {
      chat,
    };
  })(CustomerServiceSourceBadge),
);
