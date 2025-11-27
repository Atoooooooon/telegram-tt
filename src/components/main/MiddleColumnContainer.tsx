import type { RefObject } from 'react';
import type { FC } from '../../lib/teact/teact';
import { memo } from '../../lib/teact/teact';
import { withGlobal } from '../../global';

import buildClassName from '../../util/buildClassName';
import { selectCurrentMessageList } from '../../global/selectors';
import { selectIsCustomerServiceV2Open } from '../../global/selectors/customerServiceV2';

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
      <div className={buildClassName(styles.container, styles.splitView)}>
        <CustomerServiceMiddleColumn className={styles.customerServiceColumn} />
        <MiddleColumn
          leftColumnRef={leftColumnRef}
          isHalfScreen={true}
          isMobile={isMobile}
        />
      </div>
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
    const { isHalfScreen } = currentMessageList || {};

    return {
      isCustomerServiceV2Open: selectIsCustomerServiceV2Open(global),
      isHalfScreen: Boolean(isHalfScreen),
    };
  },
)(MiddleColumnContainer));
