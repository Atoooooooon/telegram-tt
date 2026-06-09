import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';

import type { CustomerServiceCasePlaybook } from '../../../../global/types/customerServiceV2';
import type { AiPlaybookRecommendation } from './CustomerServiceAiRecommendation.helpers';

import buildClassName from '../../../../util/buildClassName';

import Icon from '../../../common/icons/Icon';
import styles from './CustomerServiceMessageList.module.scss';

type OwnProps = {
  recommendation?: AiPlaybookRecommendation;
  recommendedPlaybook?: CustomerServiceCasePlaybook;
  isLoading: boolean;
  onRegenerate: NoneToVoidFunction;
  onRunPlaybook: (playbook: CustomerServiceCasePlaybook) => void;
};

const AiRecommendationCard: FC<OwnProps> = ({
  recommendation,
  recommendedPlaybook,
  isLoading,
  onRegenerate,
  onRunPlaybook,
}) => {
  const description = isLoading
    ? '正在根据当前 case 和可用 playbook 生成推荐...'
    : recommendation?.error
      ? recommendation.error
      : recommendedPlaybook
        ? recommendation?.reason || 'AI 推荐执行该 playbook。'
        : recommendation
          ? recommendation.reason
          : '等待 case 上下文稳定后生成意图识别。';
  const rawOutputParts = [
    recommendation?.rawContent ? `AI 原始返回:\n${recommendation.rawContent}` : '',
    recommendation?.rawJsonText && recommendation.rawJsonText !== recommendation.rawContent
      ? `提取的 JSON 片段:\n${recommendation.rawJsonText}`
      : '',
  ].filter(Boolean);
  const rawOutput = rawOutputParts.join('\n\n');

  return (
    <div className={styles.aiRecommendationBox}>
      <div className={styles.aiRecommendationText}>
        <div className={styles.aiRecommendationTitleRow}>
          <strong className={styles.caseActionTitle}>AI 推荐</strong>
          {rawOutput && (
            <span
              className={styles.aiRecommendationRawTrigger}
              tabIndex={0}
              aria-label="查看 AI 原始返回"
            >
              <Icon name="info" />
              <span className={styles.aiRecommendationRawTooltip}>{rawOutput}</span>
            </span>
          )}
        </div>
        <span className={buildClassName(styles.caseActionDescription, styles.aiRecommendationDescription)}>
          {description}
        </span>
        {recommendation && !recommendation.error && (
          <span className={styles.aiRecommendationMeta}>
            意图:
            {' '}
            {recommendation.intent}
            {recommendation.scenarioId ? ` · ${recommendation.scenarioId}` : ''}
          </span>
        )}
        {recommendation?.confidence !== undefined && (
          <span className={styles.aiRecommendationMeta}>
            置信度:
            {' '}
            {recommendation.confidence}
          </span>
        )}
        {recommendation?.mediaPolicy && (
          <span className={styles.aiRecommendationMeta}>
            媒体策略:
            {' '}
            {recommendation.mediaPolicy}
          </span>
        )}
        {recommendation?.knowledgeSource && (
          <span className={styles.aiRecommendationMeta}>
            场景知识:
            {' '}
            {recommendation.knowledgeSource}
            {recommendation.knowledgeAvailable === false ? ' · 不可用' : ''}
            {recommendation.knowledgeError ? ` · ${recommendation.knowledgeError}` : ''}
          </span>
        )}
        {recommendation?.finishReason && (
          <span className={styles.aiRecommendationMeta}>
            Gemini finishReason:
            {' '}
            {recommendation.finishReason}
          </span>
        )}
      </div>
      <div className={styles.aiRecommendationActions}>
        <button
          type="button"
          className={styles.caseActionSkipButton}
          onClick={onRegenerate}
          disabled={isLoading}
        >
          {isLoading ? '生成中' : '重新生成'}
        </button>
        {recommendedPlaybook && (
          <button
            type="button"
            className={styles.caseActionButton}
            onClick={() => onRunPlaybook(recommendedPlaybook)}
            disabled={isLoading}
          >
            执行
          </button>
        )}
        {recommendation
          && !recommendation.error
          && !recommendedPlaybook
          && recommendation.intent !== '暂不识别' && (
          <span className={styles.aiRecommendationNoPlaybook}>暂无可执行 playbook</span>
        )}
      </div>
    </div>
  );
};

export default memo(AiRecommendationCard);
