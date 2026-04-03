import { parseBody, readBody, sendJson } from '../lib/http.mjs';
import { sanitizeOncallCaseForResponse } from '../lib/oncall-service.mjs';

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const ALLOWED_STATUSES = new Set(['acked', 'processing', 'resolved']);

export default {
  method: 'POST',
  path: '/api/oncall/case-status',
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

    if (typeof payload.caseId !== 'string' || !payload.caseId) {
      sendJson(res, 400, { error: 'caseId is required' }, allowOrigin, allowHeaders);
      return;
    }

    if (typeof payload.status !== 'string' || !ALLOWED_STATUSES.has(payload.status)) {
      sendJson(res, 400, { error: 'status must be one of acked, processing, resolved' }, allowOrigin, allowHeaders);
      return;
    }

    const result = await oncallService.updateCaseStatus({
      caseId: payload.caseId,
      status: payload.status,
      userId: typeof payload.userId === 'string' ? payload.userId : undefined,
      createdAt: toNumber(payload.createdAt),
    });

    if (result.error === 'case_not_found') {
      sendJson(res, 404, { error: 'Case not found' }, allowOrigin, allowHeaders);
      return;
    }

    if (result.error === 'case_not_active') {
      sendJson(res, 409, {
        error: 'Case is already resolved or expired',
        case: sanitizeOncallCaseForResponse(result.caseRecord),
      }, allowOrigin, allowHeaders);
      return;
    }

    sendJson(res, 200, { ok: true, case: sanitizeOncallCaseForResponse(result.caseRecord) }, allowOrigin, allowHeaders);
  },
};
