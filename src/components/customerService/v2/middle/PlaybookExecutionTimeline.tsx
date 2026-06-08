import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';

import type { CustomerServiceCapabilityExecutionConfirmation } from '../../../../global/types/customerServiceV2';
import type { CasePlaybookRun } from './CustomerServicePlaybookRun.helpers';

import buildClassName from '../../../../util/buildClassName';

import {
  getExecutionStepFailureTitle,
  getPlaybookRunConfirmation,
  getPlaybookRunNote,
  getPlaybookRunStatusLabel,
} from './CustomerServicePlaybookRun.helpers';

import styles from './CustomerServiceMessageList.module.scss';

type OwnProps = {
  runs: CasePlaybookRun[];
  pendingConfirmations: CustomerServiceCapabilityExecutionConfirmation[];
  onRejectConfirmation: (confirmationId: string) => void;
  onApproveConfirmation: (confirmationId: string) => void;
};

const PlaybookExecutionTimeline: FC<OwnProps> = ({
  runs,
  pendingConfirmations,
  onRejectConfirmation,
  onApproveConfirmation,
}) => {
  if (!runs.length) {
    return undefined;
  }

  return (
    <div className={styles.executionTimeline}>
      {runs.map((run) => {
        const playbookRunNote = getPlaybookRunNote(run);
        const runConfirmation = getPlaybookRunConfirmation(run, pendingConfirmations);

        return (
          <div className={styles.executionRun} key={run.id}>
            <div className={styles.executionRunHeader}>
              <strong>{run.playbookName}</strong>
              <span className={buildClassName(
                styles.executionStatus,
                run.status === 'pending' && styles.executionStatusPending,
                run.status === 'success' && styles.executionStatusSuccess,
                run.status === 'failed' && styles.executionStatusFailed,
              )}
              >
                {getPlaybookRunStatusLabel(run)}
              </span>
            </div>
            {run.auditLog?.steps.length ? (
              <div className={styles.executionSteps}>
                {run.auditLog.steps.map((step) => {
                  const stepFailureTitle = getExecutionStepFailureTitle(run, step);

                  return (
                    <span
                      className={buildClassName(
                        styles.executionStep,
                        step.success === false && styles.executionStepFailed,
                        stepFailureTitle && styles.executionStepWithTooltip,
                      )}
                      key={`${run.id}-${step.stepId}`}
                      tabIndex={stepFailureTitle ? 0 : undefined}
                    >
                      {step.capabilityName || step.capabilityId}
                      {step.pending ? ' · 等待' : step.success === false ? ' · 失败' : ' · 完成'}
                      {stepFailureTitle && (
                        <span className={styles.executionStepTooltip}>
                          {stepFailureTitle}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ) : undefined}
            {playbookRunNote && (
              <small className={styles.executionNote}>{playbookRunNote}</small>
            )}
            {runConfirmation && (
              <div className={styles.executionConfirmationActions}>
                <button
                  type="button"
                  className={styles.confirmationRejectButton}
                  onClick={() => onRejectConfirmation(runConfirmation.id)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className={styles.confirmationApproveButton}
                  onClick={() => onApproveConfirmation(runConfirmation.id)}
                >
                  允许执行
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default memo(PlaybookExecutionTimeline);
