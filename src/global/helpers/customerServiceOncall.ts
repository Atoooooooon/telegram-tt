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
