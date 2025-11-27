import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { GlobalState } from '../../../../global/types';

import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID } from '../../../../global/types/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import {
  selectCustomerServiceV2MessageCount,
  selectIsCustomerServiceV2Open,
} from '../../../../global/selectors/customerServiceV2';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Icon from '../../../common/icons/Icon';
import ListItem from '../../../ui/ListItem';

import styles from './CustomerServiceListItem.module.scss';

type OwnProps = {
  className?: string;
};

type StateProps = {
  messageCount: number;
  isActive: boolean;
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
    styles.root,
    className,
    isActive && styles.active,
  );

  return (
    <ListItem
      className={fullClassName}
      onClick={handleClick}
      ripple
    >
      <div className={styles.wrapper}>
        <div className={styles.icon}>
          <Icon name="headphone" />
        </div>
        <div className={styles.content}>
          <div className={styles.title}>
            {lang('CustomerService')}
            {messageCount > 0 && (
              <span className={styles.badge}>
                {messageCount}
              </span>
            )}
          </div>
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
