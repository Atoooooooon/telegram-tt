import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';

import buildClassName from '../../../../util/buildClassName';

import CustomerServiceMiddleHeader from './CustomerServiceMiddleHeader';
import CustomerServiceMessageList from './CustomerServiceMessageList';

import styles from './CustomerServiceMiddleColumn.module.scss';

type OwnProps = {
  className?: string;
};

const CustomerServiceMiddleColumn: FC<OwnProps> = ({
  className,
}) => {
  return (
    <div className={buildClassName('CustomerServiceMiddleColumn', styles.root, className)}>
      <CustomerServiceMiddleHeader />
      <CustomerServiceMessageList />
    </div>
  );
};

export default memo(CustomerServiceMiddleColumn);
