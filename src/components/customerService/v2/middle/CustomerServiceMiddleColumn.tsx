import type { ElementRef, FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions } from '../../../../global';

import buildClassName from '../../../../util/buildClassName';

import useAppLayout from '../../../../hooks/useAppLayout';
import { useResize } from '../../../../hooks/useResize';

import CustomerServiceSettingsModal from '../setting/CustomerServiceSettingsModal';
import CustomerServiceMessageList from './CustomerServiceMessageList';

import styles from './CustomerServiceMiddleColumn.module.scss';

type OwnProps = {
  className?: string;
  leftColumnRef: ElementRef<HTMLDivElement>;
  leftColumnWidth?: number;
  columnRef?: ElementRef<HTMLDivElement>;
};

const CustomerServiceMiddleColumn: FC<OwnProps> = ({
  className,
  leftColumnRef,
  leftColumnWidth,
  columnRef,
}) => {
  const { setLeftColumnWidth, resetLeftColumnWidth } = getActions();
  const { isDesktop } = useAppLayout();

  const {
    initResize,
    resetResize,
    handleMouseUp,
  } = useResize(
    leftColumnRef,
    (width) => setLeftColumnWidth({ leftColumnWidth: width }),
    resetLeftColumnWidth,
    leftColumnWidth,
    '--left-column-width',
  );

  return (
    <div
      ref={columnRef}
      className={buildClassName('CustomerServiceMiddleColumn', styles.root, className)}
    >
      {isDesktop && (
        <div
          className={styles.resizeHandle}
          onMouseDown={initResize}
          onMouseUp={handleMouseUp}
          onDoubleClick={resetResize}
        />
      )}
      <CustomerServiceMessageList />
      <CustomerServiceSettingsModal />
    </div>
  );
};

export default memo(CustomerServiceMiddleColumn);
