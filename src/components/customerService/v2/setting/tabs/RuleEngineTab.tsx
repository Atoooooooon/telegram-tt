import type React from '../../../../../lib/teact/teact';
import type { FC } from '../../../../../lib/teact/teact';
import { memo, useRef, useState } from '../../../../../lib/teact/teact';

import type { RuleEngineConfig, UserRule } from '../../../../../global/types/customerServiceV2';
import { DEFAULT_DEBUG_RULE, DEFAULT_RULE_ENGINE_CONFIG } from '../../../../../global/helpers/customerServiceV2Settings';

import { isCapabilityRegistered } from '../../../../../global/helpers/ruleEngine';
import useLang from '../../../../../hooks/useLang';
import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';
import Modal from '../../../../ui/Modal';
import RuleEngineDoc from '../RuleEngineDoc';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './RuleEngineTab.module.scss';

type Props = {
  ruleEngineConfig?: RuleEngineConfig;
  rules?: UserRule[];
  onConfigChange: (config: RuleEngineConfig) => void;
  onRulesChange: (rules: UserRule[]) => void;
};

const RuleEngineTab: FC<Props> = ({
  ruleEngineConfig,
  rules,
  onConfigChange,
  onRulesChange,
}) => {
  const lang = useLang();
  const config = ruleEngineConfig ? { ...ruleEngineConfig } : { ...DEFAULT_RULE_ENGINE_CONFIG };
  const safeRules = rules ? rules.slice() : [];

  const [draggedIndex, setDraggedIndex] = useState<number | undefined>();
  const dragHandleActiveRef = useRef(false);
  const pendingRulesRef = useRef<UserRule[]>(safeRules);
  pendingRulesRef.current = safeRules;
  const [isRuleEditModalOpen, setIsRuleEditModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | undefined>();
  const [editingRuleJson, setEditingRuleJson] = useState('');
  const [ruleEditError, setRuleEditError] = useState<string | undefined>();

  const updateRule = useLastCallback((ruleId: string, updater: (rule: UserRule) => UserRule) => {
    onRulesChange(safeRules.map((rule) => (rule.id === ruleId ? updater(rule) : rule)));
  });

  const handleRuleToggle = useLastCallback((ruleId: string, enabled: boolean) => {
    updateRule(ruleId, (rule) => ({
      ...rule,
      enabled,
    }));
  });

  const handleDeleteRule = useLastCallback((ruleId: string) => {
    onRulesChange(safeRules.filter((rule) => rule.id !== ruleId));
  });

  const generateUniqueRuleId = useLastCallback((baseName: string = 'rule') => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${baseName}_${timestamp}_${random}`;
  });

  const handleAddRule = useLastCallback(() => {
    const newRule: UserRule = {
      id: generateUniqueRuleId('rule'),
      name: `新规则 ${safeRules.length + 1}`,
      enabled: true,
      trigger: {
        eventType: 'customer_message',
      },
      pipeline: [],
    };
    onRulesChange([newRule, ...safeRules]);
  });

  const handleRestoreDefaults = useLastCallback(() => {
    onRulesChange([JSON.parse(JSON.stringify(DEFAULT_DEBUG_RULE))]);
  });

  const handleDragStart = useLastCallback((index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    if (!dragHandleActiveRef.current) {
      event.preventDefault();
      return;
    }

    if (pendingRulesRef.current.length <= 1) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDraggedIndex(index);
  });

  const handleDragOver = useLastCallback((index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    if (pendingRulesRef.current.length <= 1) {
      return;
    }

    if (draggedIndex === undefined || draggedIndex === index) {
      return;
    }

    const next = pendingRulesRef.current.slice();
    const [moved] = next.splice(draggedIndex, 1);
    next.splice(index, 0, moved);
    pendingRulesRef.current = next;
    setDraggedIndex(index);
    onRulesChange(next);
  });

  const handleDragEnd = useLastCallback(() => {
    setDraggedIndex(undefined);
    dragHandleActiveRef.current = false;
  });

  const handleDrop = useLastCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDraggedIndex(undefined);
    dragHandleActiveRef.current = false;
  });

  const markDragHandleActive = useLastCallback(() => {
    dragHandleActiveRef.current = true;
  });

  const clearDragHandleActive = useLastCallback(() => {
    dragHandleActiveRef.current = false;
  });

  const openRuleEditModal = useLastCallback((ruleId: string) => {
    const targetRule = safeRules.find((rule) => rule.id === ruleId);
    if (!targetRule) {
      return;
    }
    setEditingRuleId(ruleId);
    setEditingRuleJson(JSON.stringify(targetRule, null, 2));
    setRuleEditError(undefined);
    setIsRuleEditModalOpen(true);
  });

  const handleRuleJsonChange = useLastCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingRuleJson(event.currentTarget.value);
    setRuleEditError(undefined);
  });

  const handleFormatRuleJson = useLastCallback(() => {
    try {
      const parsed = JSON.parse(editingRuleJson || '{}');
      setEditingRuleJson(JSON.stringify(parsed, null, 2));
      setRuleEditError(undefined);
    } catch (error) {
      setRuleEditError(error instanceof Error ? error.message : String(error));
    }
  });

  const handleApplyRuleEdit = useLastCallback(() => {
    try {
      const parsed = JSON.parse(editingRuleJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON root 必须是对象');
      }

      const updatedRule = parsed as UserRule;
      if (!updatedRule.id) {
        updatedRule.id = editingRuleId || generateUniqueRuleId('rule');
      }

      // Check for duplicate IDs (excluding the current editing rule)
      const isDuplicateId = safeRules.some(
        (rule) => rule.id !== editingRuleId && rule.id === updatedRule.id,
      );

      if (isDuplicateId) {
        setRuleEditError(`规则 ID "${updatedRule.id}" 已存在。请使用唯一的 ID 或留空自动生成。`);
        return;
      }

      // Validate capability IDs in pipeline
      if (updatedRule.pipeline && Array.isArray(updatedRule.pipeline)) {
        const invalidCapabilities: string[] = [];
        updatedRule.pipeline.forEach((step, index) => {
          if (step.capabilityId && !isCapabilityRegistered(step.capabilityId)) {
            invalidCapabilities.push(`步骤 ${index + 1}: "${step.capabilityId}"`);
          }
        });

        if (invalidCapabilities.length > 0) {
          setRuleEditError(
            `发现未注册的能力:\n${invalidCapabilities.join('\n')}\n\n请检查能力 ID 是否正确,或查看文档了解可用能力列表。`,
          );
          return;
        }
      }

      onRulesChange(safeRules.map((rule) => (rule.id === editingRuleId ? updatedRule : rule)));
      setIsRuleEditModalOpen(false);
    } catch (error) {
      setRuleEditError(error instanceof Error ? error.message : String(error));
    }
  });

  return (
    <div className={layoutStyles.tabContent}>
      <div className={layoutStyles.sectionHeader}>
        <h3>
          <Icon name="settings" className={layoutStyles.sectionIcon} />
          {lang('CustomerServiceRuleEngineRules')}
        </h3>
        <p className={layoutStyles.sectionDescription}>
          规则引擎配置（OCR、AI 等外部服务接入）
        </p>
      </div>

      <div className={styles.ruleEngineConfigPlaceholder}>
        <p className={styles.placeholderText}>
          <Icon name="lock" />
          外部 API 配置区域（开发中）
        </p>
      </div>

      <div className={layoutStyles.sectionHeader}>
        <div className={layoutStyles.sectionTitleRow}>
          <h3>
            <Icon name="menu" className={layoutStyles.sectionIcon} />
            规则列表
          </h3>
          <div className={styles.ruleEngineActions}>
            <div>
              <Button
                size="tiny"
                color="primary"
                onClick={handleAddRule}
              >
                <Icon name="add" />
                {lang('CustomerServiceRuleEngineAddRule')}
              </Button>
            </div>
            <div>
              <Button
                size="tiny"
                color="translucent"
                onClick={handleRestoreDefaults}
              >
                <Icon name="reload" />
                {lang('CustomerServiceRuleEngineRestoreDefault')}
              </Button>
            </div>
          </div>
        </div>
        <p className={layoutStyles.sectionDescription}>
          {lang('CustomerServiceRuleEngineOrderHint')}
        </p>
      </div>

      <div className={styles.ruleList}>
        {safeRules.length === 0 ? (
          <div className={styles.ruleEmpty}>
            {lang('CustomerServiceRuleEngineNoRules')}
          </div>
        ) : (
          <>
            {(() => {
              const preFilterRules = safeRules.filter((r) => r.executionPhase === 'pre-filter');
              const postFilterRules = safeRules.filter((r) => !r.executionPhase || r.executionPhase === 'post-filter');

              return (
                <>
                  {preFilterRules.length > 0 && (
                    <>
                      <div className={styles.ruleGroupHeader}>
                        <Icon name="settings" />
                        前置规则 (Pre-filter)
                        <span className={styles.ruleGroupHint}>在过滤前执行</span>
                      </div>
                      {preFilterRules.map((rule) => {
                        const index = safeRules.indexOf(rule);
                        return (
                          <div
                            className={styles.ruleCard}
                            key={rule.id}
                            draggable={safeRules.length > 1}
                            onDragStart={safeRules.length > 1 ? handleDragStart(index) : undefined}
                            onDragOver={safeRules.length > 1 ? handleDragOver(index) : undefined}
                            onDragEnd={safeRules.length > 1 ? handleDragEnd : undefined}
                            onDrop={safeRules.length > 1 ? handleDrop : undefined}
                          >
                            <div className={styles.ruleRow}>
                              <button
                                type="button"
                                className={styles.ruleCardDragHandle}
                                aria-label={lang('DragToSortAria')}
                                disabled={safeRules.length <= 1}
                                onMouseDown={markDragHandleActive}
                                onMouseUp={clearDragHandleActive}
                                onMouseLeave={clearDragHandleActive}
                                onTouchStart={markDragHandleActive}
                                onTouchEnd={clearDragHandleActive}
                                onTouchCancel={clearDragHandleActive}
                              >
                                <Icon name="sort" />
                              </button>
                              <div className={styles.ruleCardText}>
                                <div className={styles.ruleCardTitle}>
                                  <div className={styles.ruleOrderIndex}>
                                    #
                                    {index + 1}
                                  </div>
                                  <div className={styles.ruleCardName}>
                                    {rule.name || lang('CustomerServiceRuleName')}
                                  </div>
                                </div>
                                <div className={styles.ruleCardMeta}>
                                  <code>{rule.id}</code>
                                </div>
                              </div>
                              <div className={styles.ruleRowActions}>
                                <Switcher
                                  label=""
                                  checked={Boolean(rule.enabled)}
                                  onCheck={(value) => handleRuleToggle(rule.id, value)}
                                />
                                <button
                                  type="button"
                                  className={styles.ruleActionButton}
                                  aria-label={lang('CustomerServiceRuleEngineEditJson')}
                                  onClick={() => openRuleEditModal(rule.id)}
                                >
                                  <Icon name="edit" />
                                </button>
                                <button
                                  type="button"
                                  className={styles.ruleActionButton}
                                  aria-label={lang('CustomerServiceDeleteRule')}
                                  onClick={() => handleDeleteRule(rule.id)}
                                >
                                  <Icon name="delete" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}

                  {postFilterRules.length > 0 && (
                    <>
                      <div className={styles.ruleGroupHeader}>
                        <Icon name="check" />
                        后置规则 (Post-filter)
                        <span className={styles.ruleGroupHint}>在过滤后执行</span>
                      </div>
                      {postFilterRules.map((rule) => {
                        const index = safeRules.indexOf(rule);
                        return (
                          <div
                            className={styles.ruleCard}
                            key={rule.id}
                            draggable={safeRules.length > 1}
                            onDragStart={safeRules.length > 1 ? handleDragStart(index) : undefined}
                            onDragOver={safeRules.length > 1 ? handleDragOver(index) : undefined}
                            onDragEnd={safeRules.length > 1 ? handleDragEnd : undefined}
                            onDrop={safeRules.length > 1 ? handleDrop : undefined}
                          >
                            <div className={styles.ruleRow}>
                              <button
                                type="button"
                                className={styles.ruleCardDragHandle}
                                aria-label={lang('DragToSortAria')}
                                disabled={safeRules.length <= 1}
                                onMouseDown={markDragHandleActive}
                                onMouseUp={clearDragHandleActive}
                                onMouseLeave={clearDragHandleActive}
                                onTouchStart={markDragHandleActive}
                                onTouchEnd={clearDragHandleActive}
                                onTouchCancel={clearDragHandleActive}
                              >
                                <Icon name="sort" />
                              </button>
                              <div className={styles.ruleCardText}>
                                <div className={styles.ruleCardTitle}>
                                  <div className={styles.ruleOrderIndex}>
                                    #
                                    {index + 1}
                                  </div>
                                  <div className={styles.ruleCardName}>
                                    {rule.name || lang('CustomerServiceRuleName')}
                                  </div>
                                </div>
                                <div className={styles.ruleCardMeta}>
                                  <code>{rule.id}</code>
                                </div>
                              </div>
                              <div className={styles.ruleRowActions}>
                                <Switcher
                                  label=""
                                  checked={Boolean(rule.enabled)}
                                  onCheck={(value) => handleRuleToggle(rule.id, value)}
                                />
                                <button
                                  type="button"
                                  className={styles.ruleActionButton}
                                  aria-label={lang('CustomerServiceRuleEngineEditJson')}
                                  onClick={() => openRuleEditModal(rule.id)}
                                >
                                  <Icon name="edit" />
                                </button>
                                <button
                                  type="button"
                                  className={styles.ruleActionButton}
                                  aria-label={lang('CustomerServiceDeleteRule')}
                                  onClick={() => handleDeleteRule(rule.id)}
                                >
                                  <Icon name="delete" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      <Modal
        isOpen={isRuleEditModalOpen}
        onClose={() => setIsRuleEditModalOpen(false)}
        className={styles.ruleEditModal}
      >
        <div className={styles.ruleEditSplit}>
          <RuleEngineDoc />

          <div className={styles.ruleEditEditor}>
            <div className={styles.ruleEditEditorHeader}>
              <h4 className={styles.ruleEditEditorTitle}>
                <Icon name="edit" />
                JSON 配置
              </h4>
              <div className={styles.ruleEditActions}>
                <div>
                  <Button
                    size="tiny"
                    color="translucent"
                    onClick={handleFormatRuleJson}
                  >
                    <Icon name="reload" />
                    格式化
                  </Button>
                </div>
              </div>
            </div>
          <TextArea
            className={styles.ruleEditTextArea}
            value={editingRuleJson}
            onChange={handleRuleJsonChange}
            noReplaceNewlines
            autoResize={false}
          />
            <div className={styles.ruleEditFooter}>
              {ruleEditError && (
                <div className={styles.ruleEngineError}>
                  <Icon name="warning" />
                  {ruleEditError}
                </div>
              )}
              <div className={styles.ruleEditActionButtons}>
                <div>
                  <Button
                    size="smaller"
                    color="translucent"
                    onClick={() => setIsRuleEditModalOpen(false)}
                  >
                    <Icon name="close" />
                    取消
                  </Button>
                </div>
                <div>
                  <Button
                    size="smaller"
                    color="primary"
                    onClick={handleApplyRuleEdit}
                  >
                    <Icon name="check" />
                    应用
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default memo(RuleEngineTab);
