import { parseBody, readBody, sendJson } from '../lib/http.mjs';
import { sanitizeOncallCaseForResponse } from '../lib/oncall-service.mjs';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export default {
  method: 'POST',
  path: '/api/oncall/staff-reply',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, maxBodyBytes, oncallService,
    } = ctx;

    if (!oncallService) {
      sendJson(res, 503, { error: 'Oncall service unavailable' }, allowOrigin, allowHeaders);
      return;
    }

    const bodyText = await readBody(req, maxBodyBytes);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const payload = parseBody(bodyText, contentType);

    if (typeof payload.chatId !== 'string' || !payload.chatId) {
      sendJson(res, 400, { error: 'chatId is required' }, allowOrigin, allowHeaders);
      return;
    }

    const messageId = toNumber(payload.messageId);
    if (!messageId) {
      sendJson(res, 400, { error: 'messageId is required' }, allowOrigin, allowHeaders);
      return;
    }

    const result = await oncallService.reportStaffReply({
      chatId: payload.chatId,
      messageId,
      replyToMessageId: toNumber(payload.replyToMessageId),
      createdAt: toNumber(payload.createdAt),
      staffUserId: typeof payload.staffUserId === 'string' ? payload.staffUserId : undefined,
      text: typeof payload.text === 'string' ? payload.text : undefined,
      previewText: typeof payload.previewText === 'string' ? payload.previewText : undefined,
      kind: typeof payload.kind === 'string' ? payload.kind : undefined,
      oncallConfig: payload.oncallConfig && typeof payload.oncallConfig === 'object'
        ? payload.oncallConfig
        : undefined,
    });

    sendJson(res, 200, { ok: true, case: sanitizeOncallCaseForResponse(result.caseRecord) }, allowOrigin, allowHeaders);
  },
};
