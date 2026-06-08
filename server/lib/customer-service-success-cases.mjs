import { getDevRedis } from './dev-redis.mjs';
import { REDIS_KEYS } from './redis-keys.mjs';

const MAX_SUCCESS_CASES = 1000;
const MAX_MARKDOWN_TEXT_LENGTH = 4000;
const MAX_IMAGE_REFERENCES = 8;
const ALLOWED_IMAGE_REFERENCE_SOURCES = ['vision_model', 'operator', 'message_context'];

function getString(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function getBoolean(value) {
  return typeof value === 'boolean' ? value : undefined;
}

function getNumberList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function getNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value;
}

function normalizeImageReferences(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, MAX_IMAGE_REFERENCES).reduce((result, item) => {
    const record = getObject(item);
    if (!record) {
      return result;
    }

    const source = getString(record.source);
    const imageReference = {
      chatId: getString(record.chatId),
      messageId: getNumber(record.messageId),
      description: getString(record.description),
      source: source && ALLOWED_IMAGE_REFERENCE_SOURCES.includes(source) ? source : undefined,
    };

    if (imageReference.chatId || imageReference.messageId || imageReference.description) {
      result.push(imageReference);
    }

    return result;
  }, []);
}

function normalizeMarkdownText(value) {
  const text = getString(value);
  if (!text) {
    return undefined;
  }

  return text.length > MAX_MARKDOWN_TEXT_LENGTH ? `${text.slice(0, MAX_MARKDOWN_TEXT_LENGTH)}...` : text;
}

function appendMarkdownSection(lines, title, value) {
  const text = normalizeMarkdownText(value);
  if (!text) {
    return;
  }

  lines.push('', `## ${title}`, '', text);
}

function appendMarkdownListSection(lines, title, items) {
  if (!items.length) {
    return;
  }

  lines.push('', `## ${title}`, '');
  items.forEach((item) => {
    lines.push(`- ${item}`);
  });
}

function formatImageReference(reference, index) {
  const label = `图片 ${index + 1}`;
  const source = reference.source ? `来源=${reference.source}` : undefined;
  const messageRef = reference.chatId || reference.messageId
    ? `消息=${[reference.chatId, reference.messageId].filter(Boolean).join('#')}`
    : undefined;
  const description = reference.description || '未记录图片内容说明';

  return [label, source, messageRef, description].filter(Boolean).join(' | ');
}

function formatMetadataSummary(metadata) {
  if (!metadata) {
    return undefined;
  }

  const parts = [];
  if (metadata.reason) {
    parts.push(`解决原因: ${metadata.reason}`);
  }
  if (metadata.resolvedBy) {
    parts.push(`解决来源: ${metadata.resolvedBy}`);
  }
  if (metadata.confidence !== undefined) {
    parts.push(`置信度: ${metadata.confidence}`);
  }
  if (Array.isArray(metadata.playbookRuns) && metadata.playbookRuns.length) {
    const runLines = metadata.playbookRuns.map((run) => {
      const record = getObject(run);
      if (!record) {
        return 'playbook';
      }

      return [
        record.playbookName || record.playbookId || 'playbook',
        record.status ? `状态=${record.status}` : undefined,
        record.error ? `错误=${record.error}` : undefined,
      ].filter(Boolean).join(' | ');
    });
    parts.push(`Playbook 执行: ${runLines.join('；')}`);
  }

  return parts.join('\n');
}

function buildSuccessCaseMarkdown(record) {
  const lines = [
    `# Success Case: ${record.aiIntent || record.recordType}`,
    '',
    `- 记录类型: ${record.recordType}`,
    `- Case ID: ${record.caseId || '未记录'}`,
    `- Chat ID: ${record.chatId}`,
    `- 创建时间: ${new Date(record.createdAt).toISOString()}`,
  ];

  if (record.messageIds.length) {
    lines.push(`- 消息 ID: ${record.messageIds.join(', ')}`);
  }
  if (record.wasEdited !== undefined) {
    lines.push(`- 人工编辑: ${record.wasEdited ? '是' : '否'}`);
  }

  appendMarkdownSection(lines, 'Summary', record.aiSummary);
  appendMarkdownSection(lines, 'Source Case', record.sourceText);
  appendMarkdownSection(lines, 'Image Summary', record.imageSummary);
  appendMarkdownListSection(
    lines,
    'Image References',
    record.imageReferences.map(formatImageReference),
  );
  appendMarkdownSection(lines, 'AI Draft', record.aiDraft);
  appendMarkdownSection(lines, 'Final Reply', record.finalReply);
  appendMarkdownSection(lines, 'Execution Notes', formatMetadataSummary(record.metadata));

  return lines.join('\n').trim();
}

function normalizeSuccessCasePayload(payload) {
  const recordType = getString(payload.recordType);
  const chatId = getString(payload.chatId);

  const allowedRecordTypes = ['ai_draft_sent', 'ai_action_approved', 'case_resolved'];
  if (!recordType || !allowedRecordTypes.includes(recordType)) {
    throw new Error(`recordType must be one of: ${allowedRecordTypes.join(', ')}`);
  }

  if (!chatId) {
    throw new Error('chatId is required');
  }

  const createdAt = Date.now();

  const imageReferences = normalizeImageReferences(payload.imageReferences);
  const imageSummary = getString(payload.imageSummary);
  const record = {
    id: `${createdAt}:${Math.random().toString(36).slice(2, 8)}`,
    recordType,
    caseId: getString(payload.caseId),
    chatId,
    senderId: getString(payload.senderId),
    messageIds: getNumberList(payload.messageIds),
    sourceText: getString(payload.sourceText),
    aiSummary: getString(payload.aiSummary),
    aiIntent: getString(payload.aiIntent),
    aiDraft: getString(payload.aiDraft),
    finalReply: getString(payload.finalReply),
    wasEdited: getBoolean(payload.wasEdited),
    imageSummary,
    imageReferences,
    metadata: getObject(payload.metadata),
    createdAt,
  };

  return {
    ...record,
    markdown: buildSuccessCaseMarkdown(record),
  };
}

export async function saveCustomerServiceSuccessCase(log, payload) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const record = normalizeSuccessCasePayload(payload);
  await redis.lpush(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, JSON.stringify(record));
  await redis.ltrim(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, MAX_SUCCESS_CASES - 1);

  return record;
}

export async function listCustomerServiceSuccessCases(log, limit = 50) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const values = await redis.lrange(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, safeLimit - 1);

  return values.map((value) => JSON.parse(value));
}

export async function deleteCustomerServiceSuccessCase(log, id) {
  const redis = await getDevRedis(log);
  if (!redis) {
    throw new Error('Redis is not configured');
  }

  const targetId = getString(id);
  if (!targetId) {
    throw new Error('id is required');
  }

  const values = await redis.lrange(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, 0, -1);
  const remaining = [];
  let deleted = false;

  for (const value of values) {
    try {
      const record = JSON.parse(value);
      if (record?.id === targetId) {
        deleted = true;
        continue;
      }
    } catch {
      // Keep malformed historical entries instead of silently dropping data.
    }

    remaining.push(value);
  }

  if (!deleted) {
    return { deleted: false };
  }

  await redis.del(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES);
  if (remaining.length > 0) {
    await redis.rpush(REDIS_KEYS.CUSTOMER_SERVICE_SUCCESS_CASES, ...remaining);
  }

  return { deleted: true };
}
