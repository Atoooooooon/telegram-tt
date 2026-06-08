import type { CustomerServiceSuccessCaseRecord } from '../../../../global/helpers/customerServiceOncall';
import type {
  CustomerServiceCapabilityExecutionConfirmation,
  CustomerServiceRuleAuditLog,
  CustomerServiceRuleAuditStep,
  CustomerServiceRuleExecutionResult,
} from '../../../../global/types/customerServiceV2';

export type CasePlaybookRun = {
  id: string;
  playbookId: string;
  playbookName: string;
  stepConfigs?: Record<string, Record<string, unknown>>;
  status: 'running' | 'pending' | 'success' | 'failed';
  startedAt: number;
  finishedAt?: number;
  auditLog?: CustomerServiceRuleAuditLog;
  result?: CustomerServiceRuleExecutionResult;
  error?: string;
};

export type PlaybookRunsByGroupId = Record<string, CasePlaybookRun[]>;

export const STANDALONE_PLAYBOOK_RUNS_ID = '__standalone__';

const MAX_EXECUTION_NOTE_LENGTH = 140;
const MAX_PLAYBOOK_RUNS_PER_BUCKET = 20;

const playbookRunHistorySubscribers = new Set<(runs: PlaybookRunsByGroupId) => void>();
let playbookRunHistoryCache: PlaybookRunsByGroupId | undefined;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function prunePlaybookRunsByGroupId(runs: PlaybookRunsByGroupId): PlaybookRunsByGroupId {
  return Object.entries(runs).reduce<PlaybookRunsByGroupId>((result, [groupId, groupRuns]) => {
    const normalizedRuns = groupRuns
      .filter(Boolean)
      .slice(0, MAX_PLAYBOOK_RUNS_PER_BUCKET);

    if (normalizedRuns.length) {
      result[groupId] = normalizedRuns;
    }

    return result;
  }, {});
}

export function loadPlaybookRunHistory(): PlaybookRunsByGroupId {
  if (playbookRunHistoryCache) {
    return playbookRunHistoryCache;
  }

  playbookRunHistoryCache = {};
  return playbookRunHistoryCache;
}

function savePlaybookRunHistory(runs: PlaybookRunsByGroupId): void {
  playbookRunHistoryCache = prunePlaybookRunsByGroupId(runs);

  playbookRunHistorySubscribers.forEach((subscriber) => subscriber(playbookRunHistoryCache || {}));
}

export function updatePlaybookRunHistory(
  updater: (runs: PlaybookRunsByGroupId) => PlaybookRunsByGroupId,
): PlaybookRunsByGroupId {
  const nextRuns = updater(loadPlaybookRunHistory());
  savePlaybookRunHistory(nextRuns);
  return playbookRunHistoryCache || {};
}

export function subscribePlaybookRunHistory(
  subscriber: (runs: PlaybookRunsByGroupId) => void,
): NoneToVoidFunction {
  playbookRunHistorySubscribers.add(subscriber);
  return () => {
    playbookRunHistorySubscribers.delete(subscriber);
  };
}

function isPlaybookRunWaitingForConfirmation(run: CasePlaybookRun) {
  return run.status === 'pending' && Boolean(
    run.auditLog?.executionLog?.some((entry) => entry.includes('Waiting for human confirmation')),
  );
}

export function didRequestHumanConfirmation(result: CustomerServiceRuleExecutionResult) {
  return result.pending && Boolean(
    result.auditLog?.executionLog?.some((entry) => entry.includes('Waiting for human confirmation')),
  );
}

export function getPlaybookRunStatusLabel(run: CasePlaybookRun) {
  if (run.status === 'running') {
    return '执行中';
  }

  if (run.status === 'pending') {
    return isPlaybookRunWaitingForConfirmation(run) ? '等待确认' : '等待回复';
  }

  if (run.status === 'success') {
    return '已执行';
  }

  return '失败';
}

export function getPlaybookRunConfirmation(
  run: CasePlaybookRun,
  confirmations: CustomerServiceCapabilityExecutionConfirmation[],
) {
  if (run.status !== 'pending') {
    return undefined;
  }

  const ruleId = run.result?.auditLog?.ruleId || run.playbookId;
  const pendingStepIds = new Set(
    (run.auditLog?.steps || [])
      .filter((step) => step.pending)
      .map((step) => step.stepId),
  );

  return confirmations.find((confirmation) => (
    confirmation.ruleId === ruleId
    && (!pendingStepIds.size || !confirmation.stepId || pendingStepIds.has(confirmation.stepId))
  ));
}

function compactExecutionNote(note: string) {
  if (note.includes('Step Output:') && note.includes('botReplyText')) {
    return note.replace(/\[Async\] Step Output:.*/, '[Async] 已收到机器人回复，输出已写入上下文。');
  }

  const normalizedNote = note.replace(/\s+/g, ' ').trim();
  if (normalizedNote.length <= MAX_EXECUTION_NOTE_LENGTH) {
    return normalizedNote;
  }

  return `${normalizedNote.slice(0, MAX_EXECUTION_NOTE_LENGTH)}...`;
}

function formatDebugValue(value: unknown) {
  if (value === undefined || value === '' || (typeof value === 'object' && !value)) {
    return '<empty>';
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'symbol') {
    return value.description ? `Symbol(${value.description})` : 'Symbol';
  }

  if (typeof value === 'function') {
    return '[function]';
  }

  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === 'string') {
      return serialized.length > 120 ? `${serialized.slice(0, 120)}...` : serialized;
    }
  } catch {
    // Fall through to the generic object label below.
  }

  return '[unserializable object]';
}

function formatDebugJson(value: unknown) {
  try {
    const json = JSON.stringify(value, undefined, 2);
    if (typeof json !== 'string') {
      return formatDebugValue(value);
    }

    return json.length > 900 ? `${json.slice(0, 900)}...` : json;
  } catch {
    return formatDebugValue(value);
  }
}

export function formatResolvedCaseMetadata(metadata?: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }

  try {
    return JSON.stringify(metadata, undefined, 2);
  } catch {
    return undefined;
  }
}

function pushDebugField(
  lines: string[],
  label: string,
  value: unknown,
) {
  if (value === undefined || value === '' || (typeof value === 'object' && !value)) {
    return;
  }

  lines.push(`${label}: ${formatDebugValue(value)}`);
}

function parseExecutionStepOutput(entry: string): Record<string, unknown> | undefined {
  const marker = 'Step Output:';
  const markerIndex = entry.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(entry.slice(markerIndex + marker.length).trim()) as unknown;
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function getExecutionStepOutput(
  run: CasePlaybookRun,
  step: CustomerServiceRuleAuditStep,
) {
  const stepMarker = `[Step: ${step.stepId}]`;
  const executionLog = run.auditLog?.executionLog || [];

  for (let i = executionLog.length - 1; i >= 0; i--) {
    const entry = executionLog[i];
    if (!entry.includes(stepMarker) || !entry.includes('Step Output:')) {
      continue;
    }

    const output = parseExecutionStepOutput(entry);
    if (output) {
      return output;
    }
  }

  return undefined;
}

function getExecutionStepResultEntry(
  run: CasePlaybookRun,
  step: CustomerServiceRuleAuditStep,
) {
  const stepMarker = `[Step: ${step.stepId}]`;
  const executionLog = run.auditLog?.executionLog || [];

  for (let i = executionLog.length - 1; i >= 0; i--) {
    const entry = executionLog[i];
    if (entry.includes(stepMarker) && entry.includes('Step Result:')) {
      return entry.replace(/\[\d{2}:\d{2}:\d{2}\]\s*/, '').replace(stepMarker, '').trim();
    }
  }

  return undefined;
}

export function getExecutionStepFailureTitle(
  run: CasePlaybookRun,
  step: CustomerServiceRuleAuditStep,
) {
  if (step.success !== false) {
    return undefined;
  }

  const lines = [
    `步骤: ${step.capabilityName || step.capabilityId}`,
    `Step ID: ${step.stepId}`,
  ];
  const stepConfig = run.stepConfigs?.[step.stepId];
  const pipelineData = run.result?.pipelineData || {};
  const output = getExecutionStepOutput(run, step);

  if (step.error) {
    lines.push(`错误: ${step.error}`);
  }

  if (stepConfig) {
    lines.push(`参数:\n${formatDebugJson(stepConfig)}`);
  }

  const variableCheck = isPlainRecord(output?.variableCheck) ? output.variableCheck : undefined;
  if (variableCheck) {
    lines.push('变量检测未通过');
    pushDebugField(lines, '字段', variableCheck.key);
    pushDebugField(lines, '实际', variableCheck.actualValue);
    pushDebugField(lines, '期望', variableCheck.expectedValue);
  }

  if (output?.textMatched === false) {
    lines.push('文本检测未通过');
  }

  if (output?.switchMatched === false) {
    lines.push('分支匹配未命中，请检查 switch_route 的 match/mode/flags 配置');
  }

  if (isPlainRecord(stepConfig)) {
    const inputField = typeof stepConfig.inputField === 'string' ? stepConfig.inputField : undefined;
    const variableKey = typeof stepConfig.variableKey === 'string' ? stepConfig.variableKey : undefined;
    const outputField = typeof stepConfig.outputField === 'string' ? stepConfig.outputField : undefined;

    if (inputField) {
      pushDebugField(lines, `pipelineData.${inputField}`, pipelineData[inputField]);
    }
    if (variableKey && variableKey !== inputField) {
      pushDebugField(lines, `pipelineData.${variableKey}`, pipelineData[variableKey]);
    }
    if (outputField) {
      pushDebugField(lines, `pipelineData.${outputField}`, pipelineData[outputField]);
    }
  }

  [
    'text',
    'caseText',
    'botReplyText',
    'orderNumber',
    'vaNumber',
    'supplierName',
    'targetChatId',
    'switchGotoStep',
    'switchMatchedValue',
  ].forEach((key) => {
    pushDebugField(lines, `pipelineData.${key}`, pipelineData[key]);
  });

  if (output) {
    lines.push(`输出:\n${formatDebugJson(output)}`);
  }

  const resultEntry = getExecutionStepResultEntry(run, step);
  if (resultEntry) {
    lines.push(`日志: ${resultEntry}`);
  }
  if (run.error) {
    lines.push(`运行错误: ${run.error}`);
  }

  return lines.join('\n\n');
}

export function getPlaybookRunNote(run: CasePlaybookRun) {
  if (run.error) {
    return compactExecutionNote(run.error);
  }

  const steps = run.auditLog?.steps || [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const stepError = steps[i].error;
    if (stepError) {
      return compactExecutionNote(stepError);
    }
  }

  const executionNote = run.auditLog?.executionLog?.slice(-1)[0];
  return executionNote ? compactExecutionNote(executionNote) : undefined;
}

export function getResolvedCaseRecordFromResult(
  result: CustomerServiceRuleExecutionResult,
): CustomerServiceSuccessCaseRecord | undefined {
  const resolvedRecord = result.pipelineData?.resolvedRecord;
  if (!isPlainRecord(resolvedRecord)) {
    return undefined;
  }

  if (typeof resolvedRecord.id !== 'string' || typeof resolvedRecord.createdAt !== 'number') {
    return undefined;
  }

  return resolvedRecord as CustomerServiceSuccessCaseRecord;
}

export function didResolveCase(result: CustomerServiceRuleExecutionResult): boolean {
  return result.pipelineData?.caseResolved === true;
}
