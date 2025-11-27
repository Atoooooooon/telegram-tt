import type { RefObject } from 'react';
import type { FC } from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import { selectCurrentMessageList } from '../../global/selectors';
import { selectIsCustomerServiceV2Open } from '../../global/selectors/customerServiceV2';
import { selectTabState } from '../../global/selectors/tabs';
import { CUSTOMER_SERVICE_VIRTUAL_CHAT_ID } from '../../global/types/customerServiceV2';

import CustomerServiceMiddleColumn from '../customerService/v2/middle/CustomerServiceMiddleColumn';
import MiddleColumn from '../middle/MiddleColumn';

import styles from './MiddleColumnContainer.module.scss';

type OwnProps = {
  leftColumnRef: RefObject<HTMLDivElement>;
  isMobile?: boolean;
};

type StateProps = {
  isCustomerServiceV2Open?: boolean;
  isHalfScreen?: boolean;
};

const MiddleColumnContainer: FC<OwnProps & StateProps> = ({
  leftColumnRef,
  isMobile,
  isCustomerServiceV2Open,
  isHalfScreen,
}) => {
  // In customer service mode with context viewing (half-screen)
  if (isCustomerServiceV2Open && isHalfScreen) {
    return (
      <>
        <CustomerServiceMiddleColumn className={styles.customerServiceColumn} />
        <MiddleColumn
          leftColumnRef={leftColumnRef}
          isHalfScreen={true}
          isMobile={isMobile}
        />
      </>
    );
  }

  // In customer service mode without context viewing
  if (isCustomerServiceV2Open) {
    return (
      <div className={styles.container}>
        <CustomerServiceMiddleColumn />
      </div>
    );
  }

  // Normal mode (not in customer service)
  return (
    <MiddleColumn
      leftColumnRef={leftColumnRef}
      isMobile={isMobile}
    />
  );
};

export default memo(withGlobal<OwnProps>(
  (global): StateProps => {
    const currentMessageList = selectCurrentMessageList(global);
    const isCurrentHalfScreen = Boolean(currentMessageList?.isHalfScreen);
    const { messageLists } = selectTabState(global);
    const hasCustomerServiceContext = messageLists.some(
      (messageList) => messageList.chatId === CUSTOMER_SERVICE_VIRTUAL_CHAT_ID,
    );
    const isHalfScreen = isCurrentHalfScreen && hasCustomerServiceContext;
    const isCustomerServiceV2Open = selectIsCustomerServiceV2Open(global) || isHalfScreen;

    return {
      isCustomerServiceV2Open,
      isHalfScreen,
    };
  },
)(MiddleColumnContainer));
