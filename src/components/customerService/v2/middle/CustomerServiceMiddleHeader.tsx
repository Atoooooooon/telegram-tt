import type React from '../../../../lib/teact/teact';
import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';
import { getActions, withGlobal } from '../../../../global';

import type { CustomerServiceSettings } from '../../../../global/types/customerServiceV2';

import {
  selectCustomerServiceV2MessageCount,
  selectCustomerServiceV2Settings,
} from '../../../../global/selectors/customerServiceV2';
import buildClassName from '../../../../util/buildClassName';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';

import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';

import Icon from '../../../common/icons/Icon';
import Button from '../../../ui/Button';

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
  const {
    clearCustomerServiceV2Messages,
    openCustomerServiceV2Settings,
    toggleCustomerServiceV2Mode,
  } = getActions();
  const lang = useLang();

  const currentMode = settings?.mode || 'oncall';
  const modeClassName = currentMode === 'oncall' ? styles.modeOnCall : styles.modeAssist;

  const handleClearAll = useLastCallback(() => {
    clearCustomerServiceV2Messages({ tabId: getCurrentTabId(), shouldMarkRead: true });
  });

  const handleOpenSettings = useLastCallback(() => {
    openCustomerServiceV2Settings({ tabId: getCurrentTabId() });
  });

  const handleToggleMode = useLastCallback(() => {
    toggleCustomerServiceV2Mode({ tabId: getCurrentTabId() });
  });

  const handleToggleModeKey = useLastCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggleMode();
    }
  });

  return (
    <div className={buildClassName(styles.root, className)}>
      <div className={styles.info}>
        <h3 className={styles.title}>
          {lang('CustomerService')}
        </h3>
        <span className={styles.subtitle}>
          {messageCount > 0
            ? lang('CustomerServiceMessagesCount', { count: messageCount })
            : lang('CustomerServiceEmpty')}
        </span>
      </div>

      <div className={styles.actions}>
        {/* Mode indicator (read-only for now) */}
        <div
          className={buildClassName(styles.modeIndicator, modeClassName)}
          role="button"
          tabIndex={0}
          onClick={handleToggleMode}
          onKeyDown={handleToggleModeKey}
          aria-label={currentMode === 'oncall'
            ? lang('CustomerServiceOnCallMode')
            : lang('CustomerServiceAssistMode')}
        >
          <Icon name={currentMode === 'oncall' ? 'phone' : 'recent'} />
          <span className={styles.modeText}>
            {currentMode === 'oncall'
              ? lang('CustomerServiceOnCallMode')
              : lang('CustomerServiceAssistMode')}
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
    const messageCount = selectCustomerServiceV2MessageCount(global);
    const settings = selectCustomerServiceV2Settings(global);

    return {
      messageCount,
      settings,
    };
  })(CustomerServiceMiddleHeader),
);
