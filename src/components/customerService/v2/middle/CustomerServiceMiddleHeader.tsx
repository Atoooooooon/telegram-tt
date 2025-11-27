import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { CustomerServiceSettings } from '../../../../global/types/customerServiceV2';

import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import {
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2Settings,
} from '../../../../global/selectors/customerServiceV2';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Button from '../../../ui/Button';
import Icon from '../../../common/icons/Icon';

import styles from './CustomerServiceMiddleHeader.module.scss';

type OwnProps = {
  className?: string;
};

type StateProps = {
  messageCount: number;
  settings?: CustomerServiceSettings;
};

const CustomerServiceMiddleHeader: FC<OwnProps & StateProps> = ({
  className,
  messageCount,
  settings,
}) => {
  const { clearCustomerServiceMessages, openSettingsScreen } = getActions();
  const lang = useLang();

  const currentMode = settings?.mode || 'oncall';

  const handleClearAll = useLastCallback(() => {
    clearCustomerServiceMessages({ tabId: getCurrentTabId() });
  });

  const handleOpenSettings = useLastCallback(() => {
    openSettingsScreen({ tabId: getCurrentTabId() });
  });

  return (
    <div className={buildClassName(styles.root, className)}>
      <div className={styles.info}>
        <h3 className={styles.title}>
          {lang('CustomerService')}
        </h3>
        <span className={styles.subtitle}>
          {messageCount > 0
            ? `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`
            : lang('CustomerServiceEmpty')}
        </span>
      </div>

      <div className={styles.actions}>
        {/* Mode indicator (read-only for now) */}
        <div className={styles.modeIndicator}>
          <Icon name={currentMode === 'oncall' ? 'phone' : 'recent'} />
          <span className={styles.modeText}>
            {currentMode === 'oncall' ? 'On Call' : 'Assist'}
          </span>
        </div>

        {messageCount > 0 && (
          <Button
            round
            size="smaller"
            color="translucent"
            onClick={handleClearAll}
            ariaLabel={lang('CustomerServiceClearMessages')}
          >
            <Icon name="delete" />
          </Button>
        )}

        <Button
          round
          size="smaller"
          color="translucent"
          onClick={handleOpenSettings}
          ariaLabel={lang('CustomerServiceSettings')}
        >
          <Icon name="settings" />
        </Button>
      </div>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const tabId = getCurrentTabId();
    const messageCount = selectCustomerServiceV2MessageCount(global, tabId);
    const settings = selectCustomerServiceV2Settings(global, tabId);

    return {
      messageCount,
      settings,
    };
  })(CustomerServiceMiddleHeader),
);
