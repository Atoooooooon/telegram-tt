import type { FC } from '../../../../lib/teact/teact';
import { memo, useState } from '../../../../lib/teact/teact';
import { getActions } from '../../../../global';

import type { CustomerServiceSettings } from '../../../../global/types/customerServiceV2';

import useLastCallback from '../../../../hooks/useLastCallback';
import useLang from '../../../../hooks/useLang';

import Icon from '../../../common/icons/Icon';
import Button from '../../../ui/Button';
import InputText from '../../../ui/InputText';
import Modal from '../../../ui/Modal';

import styles from './CustomerServiceSettingsModal.module.scss';

type Props = {
  isOpen: boolean;
  onClose: NoneToVoidFunction;
  onDownloaded?: NoneToVoidFunction;
  onUploaded?: NoneToVoidFunction;
};

type Status = {
  type: 'success' | 'error';
  message: string;
} | undefined;

type ExistingInfo = {
  ownerId?: string;
  version?: number;
  updatedAt?: number;
  canUpdate?: boolean;
  settings: CustomerServiceSettings;
};

const CustomerServiceCloudSyncModal: FC<Props> = ({ isOpen, onClose, onDownloaded, onUploaded }) => {
  const { syncCustomerServiceV2Cloud } = getActions();
  const lang = useLang();

  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [lastToken, setLastToken] = useState<string>();
  const [existingInfo, setExistingInfo] = useState<ExistingInfo>();

  const resetState = useLastCallback(() => {
    setToken('');
    setIsLoading(false);
    setStatus(undefined);
    setLastToken(undefined);
    setExistingInfo(undefined);
  });

  const clearForm = useLastCallback(() => {
    setToken('');
    setLastToken(undefined);
    setExistingInfo(undefined);
  });

  const getDetectedMessage = useLastCallback((ownerId?: string) => (
    ownerId
      ? lang('CustomerServiceCloudSyncDetectedOwner', { owner: ownerId })
      : lang('CustomerServiceCloudSyncDetected')
  ));

  const getDownloadSuccessMessage = useLastCallback((ownerId?: string) => (
    ownerId
      ? lang('CustomerServiceCloudSyncDownloadSuccessOwner', { owner: ownerId })
      : lang('CustomerServiceCloudSyncDownloadSuccess')
  ));

  const getUploadSuccessMessage = useLastCallback((version?: number) => (
    typeof version === 'number'
      ? lang('CustomerServiceCloudSyncUploadSuccessVersion', { version: String(version) })
      : lang('CustomerServiceCloudSyncUploadSuccess')
  ));

  const handleClose = useLastCallback(() => {
    if (isLoading) {
      return;
    }
    resetState();
    onClose();
  });

  const handleDetectOrUpload = useLastCallback(() => {
    const trimmed = token.trim();
    if (!trimmed) {
      setStatus({ type: 'error', message: lang('CustomerServiceCloudSyncRequired') });
      return;
    }

    setIsLoading(true);
    setStatus(undefined);
    setLastToken(trimmed);
    setExistingInfo(undefined);

    syncCustomerServiceV2Cloud({
      token: trimmed,
      operation: 'auto',
      onExisting: (info) => {
        setIsLoading(false);
        setExistingInfo({
          ownerId: info.ownerId,
          version: info.version,
          updatedAt: info.updatedAt,
          canUpdate: info.canUpdate,
          settings: info.settings,
        });
        setStatus({
          type: 'success',
          message: getDetectedMessage(info.ownerId),
        });
      },
      onDownload: ({ ownerId }) => {
        setIsLoading(false);
        setStatus({
          type: 'success',
          message: getDownloadSuccessMessage(ownerId),
        });
        clearForm();
        onDownloaded?.();
      },
      onUpload: (info) => {
        setIsLoading(false);
        setStatus({
          type: 'success',
          message: getUploadSuccessMessage(info?.version),
        });
        clearForm();
        onUploaded?.();
      },
      onError: (error) => {
        setIsLoading(false);
        setStatus({
          type: 'error',
          message: error?.message || lang('CustomerServiceCloudSyncFailed'),
        });
        setExistingInfo(undefined);
      },
    });
  });

  const handleDownloadExisting = useLastCallback(() => {
    if (!lastToken || !existingInfo) {
      return;
    }

    setIsLoading(true);
    setStatus(undefined);

    syncCustomerServiceV2Cloud({
      token: lastToken,
      operation: 'download',
      existingData: existingInfo,
      onDownload: ({ ownerId }) => {
        setIsLoading(false);
        setStatus({
          type: 'success',
          message: getDownloadSuccessMessage(ownerId),
        });
        clearForm();
        onDownloaded?.();
      },
      onError: (error) => {
        setIsLoading(false);
        setStatus({
          type: 'error',
          message: error?.message || lang('CustomerServiceCloudSyncFailed'),
        });
      },
    });
  });

  const handleUploadExisting = useLastCallback(() => {
    if (!lastToken) {
      return;
    }

    setIsLoading(true);
    setStatus(undefined);

    syncCustomerServiceV2Cloud({
      token: lastToken,
      operation: 'upload',
      onUpload: (info) => {
        setIsLoading(false);
        setStatus({
          type: 'success',
          message: getUploadSuccessMessage(info?.version),
        });
        clearForm();
        onUploaded?.();
      },
      onError: (error) => {
        setIsLoading(false);
        setStatus({
          type: 'error',
          message: error?.message || lang('CustomerServiceCloudSyncFailed'),
        });
      },
    });
  });

  const canUpdate = Boolean(existingInfo && existingInfo.canUpdate !== false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className={styles.cloudSyncModal}
      title={lang('CustomerServiceCloudSyncTitle')}
    >
      <div className={styles.cloudSyncContent}>
        <p className={styles.cloudSyncHint}>
          {lang('CustomerServiceCloudSyncHint')}
        </p>

        <InputText
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
          placeholder={lang('CustomerServiceCloudSyncPlaceholder')}
          className={styles.cloudSyncInput}
          disabled={isLoading}
        />

        {status && (
          <div
            className={status.type === 'success' ? styles.cloudSyncStatusSuccess : styles.cloudSyncStatusError}
          >
            <Icon name={status.type === 'success' ? 'check' : 'warning'} />
            <span>{status.message}</span>
          </div>
        )}

        <div className={styles.cloudSyncActions}>
          <Button
            size="smaller"
            color="translucent"
            onClick={handleClose}
            disabled={isLoading}
          >
            {lang('CustomerServiceCloudSyncCancel')}
          </Button>
          {existingInfo ? (
            <>
              {canUpdate && (
                <Button
                  size="smaller"
                  color="translucent"
                  onClick={handleUploadExisting}
                  disabled={isLoading}
                  loadingLabelKey={lang("CustomerServiceCloudSyncPleaseWait")}
                  isLoading={isLoading}
                >
                  <Icon name="reload" />
                  {lang('CustomerServiceCloudSyncUpdate')}
                </Button>
              )}
              <Button
                size="smaller"
                color="primary"
                onClick={handleDownloadExisting}
                isLoading={isLoading}
                loadingLabelKey={lang("CustomerServiceCloudSyncPleaseWait")}
              >
                <Icon name="cloud-download" />
                {lang('CustomerServiceCloudSyncSync')}
              </Button>
            </>
          ) : (
            <Button
              size="smaller"
              color="primary"
              onClick={handleDetectOrUpload}
              isLoading={isLoading}
              loadingLabelKey={lang("CustomerServiceCloudSyncPleaseWait")}
            >
              <Icon name="cloud-download" />
              {lang('CustomerServiceCloudSyncStart')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default memo(CustomerServiceCloudSyncModal);
