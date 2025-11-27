import type { FC } from '../../../../lib/teact/teact';
import { memo, useMemo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { GlobalState } from '../../../../global/types';
import type { CustomPeer } from '../../../../types';

import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID } from '../../../../global/types/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import { formatIntegerCompact } from '../../../../util/textFormat';

import {
  selectCustomerServiceV2MessageCount,
  selectIsCustomerServiceV2Open,
} from '../../../../global/selectors/customerServiceV2';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Avatar from '../../../common/Avatar';
import FullNameTitle from '../../../common/FullNameTitle';
import ListItem from '../../../ui/ListItem';
import Badge from '../../../ui/Badge';

import styles from './CustomerServiceListItem.module.scss';
import '../../../left/main/Chat.scss';

type OwnProps = {
  className?: string;
};

type StateProps = {
  messageCount: number;
  isActive: boolean;
};

const CUSTOMER_SERVICE_PEER: CustomPeer = {
  isCustomPeer: true,
  titleKey: '客户服务',
  customPeerAvatarColor: 'var(--color-primary)',
};

const CustomerServiceListItem: FC<OwnProps & StateProps> = ({
  className,
  messageCount,
  isActive,
}) => {
  const { openChat } = getActions();
  const lang = useLang();

  const handleClick = useLastCallback(() => {
    openChat({
      id: CUSTOMER_SERVICE_VIRTUAL_CHAT_ID,
      tabId: getCurrentTabId(),
    });
  });

  const fullClassName = buildClassName(
    'Chat',
    'chat-item-clickable',
    styles.root,
    className,
    isActive && 'selected',
    'customer-service-chat',
  );

  const badgeText = useMemo(() => (messageCount > 0 ? formatIntegerCompact(lang, messageCount) : undefined), [
    lang,
    messageCount,
  ]);

  const subtitle = useMemo(() => (
    messageCount > 0 ? lang('CustomerServiceOnCallModeDescription') : lang('CustomerServiceEmptyHint')
  ), [lang, messageCount]);

  return (
    <ListItem
      className={fullClassName}
      onClick={handleClick}
      ripple
      style="top: 0"
    >
      <div className="status status-clickable">
        <Avatar
          peer={CUSTOMER_SERVICE_PEER}
          size="large"
          withStory={false}
        />
      </div>
      <div className="info">
        <div className="info-row">
          <FullNameTitle
            peer={CUSTOMER_SERVICE_PEER}
            noFake
            noVerified
            withEmojiStatus={false}
          />
          {badgeText && (
            <>
              <div className="separator" />
              <Badge className={styles.badge} text={badgeText} />
            </>
          )}
        </div>
        <div className="subtitle">
          <span className={styles.subtitle}>
            {subtitle}
          </span>
        </div>
      </div>
    </ListItem>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const tabId = getCurrentTabId();
    const messageCount = selectCustomerServiceV2MessageCount(global, tabId);
    const isActive = selectIsCustomerServiceV2Open(global, tabId);

    return {
      messageCount,
      isActive,
    };
  })(CustomerServiceListItem),
);
