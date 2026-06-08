import type React from '../../../../../lib/teact/teact';
import type { FC } from '../../../../../lib/teact/teact';
import { memo, useState } from '../../../../../lib/teact/teact';

import type { ApiChat } from '../../../../../api/types';
import type {
  ActionExecution,
  CustomerServiceCasePlaybook,
  CustomerServiceOncallSettings,
  PipelineStep,
  UserRule,
} from '../../../../../global/types/customerServiceV2';
import type { TopicsInfo } from '../../../../../types';

import { registerAllCapabilities } from '../../../../../global/helpers/capabilities';
import {
  getDefaultCustomerServiceCasePlaybooks,
  normalizeCustomerServiceCasePlaybooks,
} from '../../../../../global/helpers/customerServiceV2Settings';
import {
  getAllRegisteredCapabilityIds,
  isCapabilityRegistered,
} from '../../../../../global/helpers/ruleEngine';

import useLang from '../../../../../hooks/useLang';
import useLastCallback from '../../../../../hooks/useLastCallback';

import Icon from '../../../../common/icons/Icon';
import Button from '../../../../ui/Button';
import Modal from '../../../../ui/Modal';
import Switcher from '../../../../ui/Switcher';
import TextArea from '../../../../ui/TextArea';
import RuleEngineDoc from '../RuleEngineDoc';
import ChatTopicPicker from './ChatTopicPicker';

import layoutStyles from '../CustomerServiceSettingsModal.module.scss';
import styles from './RuleEngineTab.module.scss';

type AutomationKind = 'message_rule' | 'case_playbook';
type AutomationItem = UserRule | CustomerServiceCasePlaybook;

type Props = {
  rules?: UserRule[];
  casePlaybooks?: CustomerServiceCasePlaybook[];
  oncall?: CustomerServiceOncallSettings;
  chats: Record<string, ApiChat>;
  topicsInfoByChatId: Record<string, TopicsInfo>;
  onLoadTopics: (payload: { chatId: string; force?: boolean }) => void;
  onRulesChange: (rules: UserRule[]) => void;
  onCasePlaybooksChange: (playbooks: CustomerServiceCasePlaybook[]) => void;
  onOncallChange: (nextOncall: CustomerServiceOncallSettings) => void;
};

function cloneAutomationItem<T extends AutomationItem>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}

function generateUniqueId(baseName: string = 'automation'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${baseName}_${timestamp}_${random}`;
}

function validateExecutionPolicy(value: unknown, source: string, errors: string[]): void {
  if (value !== undefined && value !== 'auto' && value !== 'confirm') {
    const displayValue = typeof value === 'string' ? value : JSON.stringify(value);
    errors.push(`${source}: "${displayValue || '<invalid>'}"`);
  }
}

function validateExecutionPolicyByMode(value: unknown, source: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${source}: "${JSON.stringify(value) || '<invalid>'}"`);
    return;
  }

  Object.entries(value).forEach(([mode, policy]) => {
    if (mode !== 'oncall' && mode !== 'assist') {
      errors.push(`${source}.${mode}: "<invalid mode>"`);
      return;
    }
    validateExecutionPolicy(policy, `${source}.${mode}`, errors);
  });
}

function validateActionExecution(
  actionExecution: ActionExecution | undefined,
  source: string,
  invalidCapabilities: string[],
  invalidExecutionPolicies: string[],
): void {
  if (!actionExecution) {
    return;
  }

  if (typeof actionExecution === 'string') {
    if (!isCapabilityRegistered(actionExecution)) {
      invalidCapabilities.push(`${source}: "${actionExecution}"`);
    }
    return;
  }

  if (typeof actionExecution.capabilityId === 'string' && !isCapabilityRegistered(actionExecution.capabilityId)) {
    invalidCapabilities.push(`${source}: "${actionExecution.capabilityId}"`);
  }
  validateExecutionPolicy(actionExecution.executionPolicy, source, invalidExecutionPolicies);
  validateExecutionPolicyByMode(
    actionExecution.executionPolicyByMode,
    `${source}.executionPolicyByMode`,
    invalidExecutionPolicies,
  );
}

function validatePipelineCapabilities(pipeline: PipelineStep[] | undefined): string | undefined {
  if (!Array.isArray(pipeline)) {
    return undefined;
  }

  registerAllCapabilities();

  const registeredCapabilities = getAllRegisteredCapabilityIds().sort();
  const invalidCapabilities: string[] = [];
  const invalidExecutionPolicies: string[] = [];

  pipeline.forEach((step, index) => {
    const source = `步骤 ${index + 1}`;

    if (step.capabilityId && !isCapabilityRegistered(step.capabilityId)) {
      invalidCapabilities.push(`${source}: "${step.capabilityId}"`);
    }

    validateExecutionPolicy(step.executionPolicy, source, invalidExecutionPolicies);
    validateExecutionPolicyByMode(
      step.executionPolicyByMode,
      `${source}.executionPolicyByMode`,
      invalidExecutionPolicies,
    );
    validateActionExecution(
      step.onSuccess?.executeAction,
      `${source} onSuccess.executeAction`,
      invalidCapabilities,
      invalidExecutionPolicies,
    );
    validateActionExecution(
      step.onFailure?.executeAction,
      `${source} onFailure.executeAction`,
      invalidCapabilities,
      invalidExecutionPolicies,
    );
  });

  if (invalidCapabilities.length > 0) {
    return `发现未注册的能力:\n${invalidCapabilities.join('\n')}`
      + (registeredCapabilities.length > 0 ? `\n\n可用能力:\n${registeredCapabilities.join('\n')}` : '')
      + '\n\n请检查能力 ID 是否正确,或查看文档了解可用能力列表。';
  }

  if (invalidExecutionPolicies.length > 0) {
    return `发现无效执行策略:\n${invalidExecutionPolicies.join('\n')}`
      + '\n\nexecutionPolicy 只能是 "auto" 或 "confirm"; executionPolicyByMode 只支持 oncall/assist。';
  }

  return undefined;
}

const RuleEngineTab: FC<Props> = ({
  rules,
  casePlaybooks,
  oncall,
  chats,
  topicsInfoByChatId,
  onLoadTopics,
  onRulesChange,
  onCasePlaybooksChange,
  onOncallChange,
}) => {
  const lang = useLang();
  const safeRules = rules ? rules.slice() : [];
  const safePlaybooks = normalizeCustomerServiceCasePlaybooks(casePlaybooks);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingKind, setEditingKind] = useState<AutomationKind>('message_rule');
  const [editingItemId, setEditingItemId] = useState<string | undefined>();
  const [editingJson, setEditingJson] = useState('');
  const [editError, setEditError] = useState<string | undefined>();

  const getItems = useLastCallback((kind: AutomationKind): AutomationItem[] => (
    kind === 'case_playbook' ? safePlaybooks : safeRules
  ));

  const setItems = useLastCallback((kind: AutomationKind, items: AutomationItem[]) => {
    if (kind === 'case_playbook') {
      onCasePlaybooksChange(normalizeCustomerServiceCasePlaybooks(items));
      return;
    }

    onRulesChange(items as UserRule[]);
  });

  const handleToggle = useLastCallback((kind: AutomationKind, itemId: string, enabled: boolean) => {
    const items = getItems(kind);
    setItems(kind, items.map((item) => (item.id === itemId ? { ...item, enabled } : item)));
  });

  const handleDelete = useLastCallback((kind: AutomationKind, itemId: string) => {
    setItems(kind, getItems(kind).filter((item) => item.id !== itemId));
  });

  const handleMove = useLastCallback((kind: AutomationKind, itemId: string, offset: number) => {
    const items = getItems(kind);
    const index = items.findIndex((item) => item.id === itemId);
    const nextIndex = index + offset;

    if (index < 0 || nextIndex < 0 || nextIndex >= items.length) {
      return;
    }

    const nextItems = items.slice();
    const [moved] = nextItems.splice(index, 1);
    nextItems.splice(nextIndex, 0, moved);
    setItems(kind, nextItems);
  });

  const handleAddRule = useLastCallback(() => {
    const newRule: UserRule = {
      id: generateUniqueId('rule'),
      name: `新规则 ${safeRules.length + 1}`,
      enabled: true,
      trigger: {
        eventType: 'customer_message',
      },
      pipeline: [],
    };
    onRulesChange([newRule, ...safeRules]);
  });

  const handleAddPlaybook = useLastCallback(() => {
    const [defaultPlaybook] = getDefaultCustomerServiceCasePlaybooks();
    const newPlaybook: CustomerServiceCasePlaybook = {
      ...cloneAutomationItem(defaultPlaybook),
      id: generateUniqueId('case_playbook'),
      name: `Case Playbook ${safePlaybooks.length + 1}`,
    };
    onCasePlaybooksChange([newPlaybook, ...safePlaybooks]);
  });

  const handleSuspendConfirmTargetChange = useLastCallback((nextValue: { chatId?: string; threadId?: string }) => {
    onOncallChange({
      ...(oncall || {}),
      suspendConfirmChatId: nextValue.chatId,
      suspendConfirmThreadId: nextValue.threadId,
    });
  });

  const openEditModal = useLastCallback((kind: AutomationKind, itemId: string) => {
    const item = getItems(kind).find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    setEditingKind(kind);
    setEditingItemId(itemId);
    setEditingJson(JSON.stringify(item, undefined, 2));
    setEditError(undefined);
    setIsEditModalOpen(true);
  });

  const handleJsonChange = useLastCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEditingJson(event.currentTarget.value);
    setEditError(undefined);
  });

  const handleFormatJson = useLastCallback(() => {
    try {
      const parsed = JSON.parse(editingJson || '{}');
      setEditingJson(JSON.stringify(parsed, undefined, 2));
      setEditError(undefined);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  });

  const handleApplyEdit = useLastCallback(() => {
    try {
      const parsed = JSON.parse(editingJson || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('JSON root 必须是对象');
      }

      const items = getItems(editingKind);
      const updatedItem = parsed as AutomationItem;
      if (!updatedItem.id) {
        updatedItem.id = editingItemId || generateUniqueId(editingKind);
      }

      const duplicate = items.some((item) => item.id !== editingItemId && item.id === updatedItem.id);
      if (duplicate) {
        setEditError(`ID "${updatedItem.id}" 已存在。请使用唯一 ID 或留空自动生成。`);
        return;
      }

      const validationError = validatePipelineCapabilities(updatedItem.pipeline);
      if (validationError) {
        setEditError(validationError);
        return;
      }

      if (editingKind === 'case_playbook') {
        const playbook = updatedItem as CustomerServiceCasePlaybook;
        playbook.kind = 'case_playbook';
        playbook.exposable = playbook.exposable !== false;
        playbook.manualRunnable = playbook.manualRunnable !== false;
        playbook.trigger = {
          ...(playbook.trigger || {}),
          eventType: 'case_manual',
        };
        setItems(editingKind, items.map((item) => (item.id === editingItemId ? playbook : item)));
      } else {
        setItems(editingKind, items.map((item) => (item.id === editingItemId ? updatedItem : item)));
      }

      setIsEditModalOpen(false);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  });

  const renderCard = (item: AutomationItem, kind: AutomationKind, index: number, total: number) => (
    <div className={styles.ruleCard} key={item.id}>
      <div className={styles.ruleRow}>
        <div className={styles.ruleOrderControl}>
          <button
            type="button"
            className={styles.ruleOrderMoveButton}
            aria-label="上移"
            disabled={index === 0}
            onClick={() => handleMove(kind, item.id, -1)}
          >
            <Icon name="down" className={styles.ruleOrderMoveIconUp} />
          </button>
          <span className={styles.ruleOrderIndex}>
            #
            {index + 1}
          </span>
          <button
            type="button"
            className={styles.ruleOrderMoveButton}
            aria-label="下移"
            disabled={index >= total - 1}
            onClick={() => handleMove(kind, item.id, 1)}
          >
            <Icon name="down" />
          </button>
        </div>
        <div className={styles.ruleCardText}>
          <div className={styles.ruleCardTitle}>
            <div className={styles.ruleCardName}>
              {item.name || (kind === 'case_playbook' ? 'Case Playbook' : lang('CustomerServiceRuleName'))}
            </div>
          </div>
          <div className={styles.ruleCardMeta}>
            <code>{item.id}</code>
            <span className={styles.ruleCardMetaDivider}>/</span>
            <span>{item.trigger?.eventType || 'any_message'}</span>
            <span className={styles.ruleCardMetaDivider}>/</span>
            <span>
              {item.pipeline?.length || 0}
              {' '}
              steps
            </span>
          </div>
        </div>
        <div className={styles.ruleRowActions}>
          <Switcher
            label=""
            checked={Boolean(item.enabled)}
            onCheck={(value) => handleToggle(kind, item.id, value)}
          />
          <button
            type="button"
            className={styles.ruleActionButton}
            aria-label={lang('CustomerServiceRuleEngineEditJson')}
            onClick={() => openEditModal(kind, item.id)}
          >
            <Icon name="edit" />
          </button>
          <button
            type="button"
            className={styles.ruleActionButton}
            aria-label={lang('CustomerServiceDeleteRule')}
            onClick={() => handleDelete(kind, item.id)}
          >
            <Icon name="delete" />
          </button>
        </div>
      </div>
      {kind === 'case_playbook' && 'description' in item && item.description && (
        <p className={styles.ruleCardDescription}>{item.description}</p>
      )}
    </div>
  );

  const renderAutomationSection = (
    kind: AutomationKind,
    title: string,
    description: string,
    items: AutomationItem[],
    onAdd: NoneToVoidFunction,
    onRestore: NoneToVoidFunction,
    emptyText: string,
  ) => (
    <section className={styles.automationSection}>
      <div className={layoutStyles.sectionHeader}>
        <div className={layoutStyles.sectionTitleRow}>
          <h3>
            <Icon name={kind === 'case_playbook' ? 'bots' : 'menu'} className={layoutStyles.sectionIcon} />
            {title}
          </h3>
          <div className={styles.ruleEngineActions}>
            <div>
              <Button
                size="tiny"
                color="primary"
                onClick={onAdd}
              >
                <Icon name="add" />
                新增
              </Button>
            </div>
            <div>
              <Button
                size="tiny"
                color="translucent"
                onClick={onRestore}
              >
                <Icon name="reload" />
                {kind === 'case_playbook' ? '恢复 Demo' : lang('CustomerServiceRuleEngineRestoreDefault')}
              </Button>
            </div>
          </div>
        </div>
        <p className={layoutStyles.sectionDescription}>{description}</p>
      </div>

      <div className={styles.ruleList}>
        {items.length ? (
          items.map((item, index) => renderCard(item, kind, index, items.length))
        ) : (
          <div className={styles.ruleEmpty}>{emptyText}</div>
        )}
      </div>
    </section>
  );

  return (
    <div className={layoutStyles.tabContent}>
      <div className={layoutStyles.sectionHeader}>
        <h3>
          <Icon name="settings" className={layoutStyles.sectionIcon} />
          自动化
        </h3>
        <p className={layoutStyles.sectionDescription}>
          消息规则处理单条 Telegram 消息；Case Playbook 以工作台 case 为入口，供 AI 推荐和人工点击执行。
        </p>
      </div>

      <section className={styles.automationConfigCard}>
        <div className={styles.automationConfigHeader}>
          <Icon name="lock" className={styles.automationConfigIcon} />
          <div>
            <h4 className={styles.automationConfigTitle}>远程确认群</h4>
            <p className={styles.automationConfigDescription}>
              <code className={styles.automationConfigCode}>suspend_for_human</code>
              {' '}
              会把确认消息发送到这里；手机 reply 1 / OK / 确认 / 继续 后，本机继续执行后续 Playbook。
            </p>
          </div>
        </div>
        <ChatTopicPicker
          chats={chats}
          topicsInfoByChatId={topicsInfoByChatId}
          value={{
            chatId: oncall?.suspendConfirmChatId,
            threadId: oncall?.suspendConfirmThreadId,
          }}
          chatLabel="确认群"
          topicLabel="确认话题"
          disabledLabel="未设置确认群"
          topicDisabledLabel="不指定话题"
          clearDescription="清空后会回退到消息保障告警群"
          searchPlaceholder="搜索确认群"
          onLoadTopics={onLoadTopics}
          onChange={handleSuspendConfirmTargetChange}
        />
      </section>

      {renderAutomationSection(
        'message_rule',
        '消息规则',
        '兼容当前生产规则，按单条消息触发，适合转发、过滤、自动回复和消息保障前置处理。',
        safeRules,
        handleAddRule,
        () => onRulesChange([]),
        lang('CustomerServiceRuleEngineNoRules'),
      )}

      {renderAutomationSection(
        'case_playbook',
        'Case Playbook',
        '以工作台 case 为单位执行 pipeline。可读取 caseText、caseSummary、orderNumber 等上下文，适合查单、反馈上游、等待机器人回复。',
        safePlaybooks,
        handleAddPlaybook,
        () => onCasePlaybooksChange(getDefaultCustomerServiceCasePlaybooks()),
        '暂无 Case Playbook。可恢复 Demo 或新增 JSON。',
      )}

      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
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
                    onClick={handleFormatJson}
                  >
                    <Icon name="reload" />
                    格式化
                  </Button>
                </div>
              </div>
            </div>
            <TextArea
              className={styles.ruleEditTextArea}
              value={editingJson}
              onChange={handleJsonChange}
              noReplaceNewlines
              autoResize={false}
            />
            <div className={styles.ruleEditFooter}>
              {editError && (
                <div className={styles.ruleEngineError}>
                  <Icon name="warning" />
                  {editError}
                </div>
              )}
              <div className={styles.ruleEditActionButtons}>
                <div>
                  <Button
                    size="smaller"
                    color="translucent"
                    onClick={() => setIsEditModalOpen(false)}
                  >
                    <Icon name="close" />
                    取消
                  </Button>
                </div>
                <div>
                  <Button
                    size="smaller"
                    color="primary"
                    onClick={handleApplyEdit}
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
