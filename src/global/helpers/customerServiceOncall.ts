import type { CustomerServiceOncallSettings } from '../types/customerServiceV2';

type CustomerServiceUsefulMessagePayload = {
  chatId: string;
  messageId: number;
  createdAt?: number;
  chatTitle?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  previewText?: string;
  oncallConfig?: CustomerServiceOncallSettings;
};

type CustomerServiceStaffReplyPayload = {
  chatId: string;
  messageId: number;
  replyToMessageId?: number;
  createdAt?: number;
  staffUserId?: string;
  text?: string;
  previewText?: string;
  kind?: string;
  oncallConfig?: CustomerServiceOncallSettings;
};

export type CustomerServiceSuccessCaseImageReference = {
  chatId?: string;
  messageId?: number;
  description?: string;
  source?: 'vision_model' | 'operator' | 'message_context';
};

type CustomerServiceSuccessCasePayload = {
  recordType: 'ai_draft_sent' | 'ai_action_approved' | 'case_resolved';
  caseId?: string;
  chatId: string;
  senderId?: string;
  messageIds?: number[];
  sourceText?: string;
  aiSummary?: string;
  aiIntent?: string;
  aiDraft?: string;
  finalReply?: string;
  wasEdited?: boolean;
  imageSummary?: string;
  imageReferences?: CustomerServiceSuccessCaseImageReference[];
  metadata?: Record<string, unknown>;
};

export type CustomerServiceSuccessCaseRecord = CustomerServiceSuccessCasePayload & {
  id: string;
  createdAt: number;
  markdown?: string;
};

type CustomerServiceSuccessCaseMutationResult = {
  ok: boolean;
  record?: CustomerServiceSuccessCaseRecord;
  deleted?: boolean;
  error?: string;
};

type CustomerServiceSuccessCasesListResult = {
  ok: boolean;
  records?: CustomerServiceSuccessCaseRecord[];
  error?: string;
};

export type CustomerServiceSuspendGateStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type CustomerServiceSuspendGate = {
  id: string;
  idempotencyKey?: string;
  status: CustomerServiceSuspendGateStatus;
  title: string;
  prompt: string;
  sourceChatId?: string;
  sourceMessageId?: number;
  caseId?: string;
  orderNumber?: string;
  ruleId?: string;
  ruleName?: string;
  stepId?: string;
  decisionContext?: Record<string, unknown>;
  controlChatId?: string;
  controlThreadId?: string;
  controlMessageId?: number;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  approvalText?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  rejectionText?: string;
  error?: string;
};

export type CustomerServiceSuspendGatePayload = {
  idempotencyKey?: string;
  title?: string;
  prompt?: string;
  timeoutMs?: number;
  sourceChatId?: string;
  sourceMessageId?: number;
  caseId?: string;
  orderNumber?: string;
  ruleId?: string;
  ruleName?: string;
  stepId?: string;
  decisionContext?: Record<string, unknown>;
  controlChatId?: string;
  controlThreadId?: string;
  oncallConfig?: CustomerServiceOncallSettings;
};

type CustomerServiceSuspendGateResult = {
  ok: boolean;
  gate?: CustomerServiceSuspendGate;
  error?: string;
};

function logOncallSyncDebug(message: string, extra?: unknown) {
  if (typeof console === 'undefined') {
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[CustomerServiceOncall]', message, extra || '');
}

async function postJson(path: string, payload: Record<string, unknown>) {
  if (typeof fetch === 'undefined') {
    return;
  }

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logOncallSyncDebug(`POST ${path} failed`, {
        status: response.status,
        payload,
      });
      return;
    }

    logOncallSyncDebug(`POST ${path} succeeded`, {
      payload,
      status: response.status,
    });
  } catch (error) {
    logOncallSyncDebug(`Failed to POST ${path}`, error);
  }
}

async function postJsonWithResult(
  path: string,
  payload: Record<string, unknown>,
): Promise<CustomerServiceSuccessCaseMutationResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      record: data.record,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveCustomerServiceSuccessCase(
  payload: CustomerServiceSuccessCasePayload,
): Promise<CustomerServiceSuccessCaseMutationResult> {
  return postJsonWithResult('/api/customer-service/success-case', payload);
}

export async function listCustomerServiceSuccessCases(limit = 50): Promise<CustomerServiceSuccessCasesListResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch(`/api/customer-service/success-cases?limit=${encodeURIComponent(String(limit))}`);
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      records: Array.isArray(data.records) ? data.records : [],
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deleteCustomerServiceSuccessCase(
  id: string,
): Promise<CustomerServiceSuccessCaseMutationResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch(`/api/customer-service/success-case?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      deleted: Boolean(data.deleted),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function createCustomerServiceSuspendGate(
  payload: CustomerServiceSuspendGatePayload,
): Promise<CustomerServiceSuspendGateResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch('/api/customer-service/suspend-gate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      gate: data.gate,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getCustomerServiceSuspendGate(
  id: string,
): Promise<CustomerServiceSuspendGateResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch(`/api/customer-service/suspend-gate?id=${encodeURIComponent(id)}`);
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      gate: data.gate,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function reportCustomerServiceUsefulMessage(payload: CustomerServiceUsefulMessagePayload) {
  void postJson('/api/oncall/useful-message', payload);
}

export function reportCustomerServiceStaffReply(payload: CustomerServiceStaffReplyPayload) {
  logOncallSyncDebug('Sending oncall staff reply', {
    chatId: payload.chatId,
    messageId: payload.messageId,
    replyToMessageId: payload.replyToMessageId,
    staffUserId: payload.staffUserId,
    text: payload.text,
  });
  void postJson('/api/oncall/staff-reply', payload);
}

export function reportCustomerServiceSuccessCase(payload: CustomerServiceSuccessCasePayload) {
  void postJson('/api/customer-service/success-case', payload);
}
