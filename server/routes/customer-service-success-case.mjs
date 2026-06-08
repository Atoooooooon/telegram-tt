import { saveCustomerServiceSuccessCase } from '../lib/customer-service-success-cases.mjs';
import { parseBody, readBody, sendJson } from '../lib/http.mjs';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export default {
  method: 'POST',
  path: '/api/customer-service/success-case',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, maxBodyBytes, log,
    } = ctx;

    const bodyText = await readBody(req, maxBodyBytes);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const payload = parseBody(bodyText, contentType);

    try {
      const record = await saveCustomerServiceSuccessCase(log, payload);
      log('Customer service success case saved', {
        recordType: record.recordType,
        caseId: record.caseId,
        chatId: record.chatId,
        id: record.id,
      });
      sendJson(res, 200, { ok: true, record }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      const statusCode = message.includes('Redis is not configured') ? 503 : 400;

      log('Customer service success case save failed', {
        error: message,
      });
      sendJson(res, statusCode, { ok: false, error: message }, allowOrigin, allowHeaders);
    }
  },
};
