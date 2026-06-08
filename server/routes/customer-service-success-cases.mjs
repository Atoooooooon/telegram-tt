import { listCustomerServiceSuccessCases } from '../lib/customer-service-success-cases.mjs';
import { sendJson } from '../lib/http.mjs';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export default {
  method: 'GET',
  path: '/api/customer-service/success-cases',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, log,
    } = ctx;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const limit = url.searchParams.get('limit') || undefined;

    try {
      const records = await listCustomerServiceSuccessCases(log, limit);
      sendJson(res, 200, { ok: true, records }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      const statusCode = message.includes('Redis is not configured') ? 503 : 400;

      log('Customer service success cases list failed', {
        error: message,
      });
      sendJson(res, statusCode, { ok: false, error: message }, allowOrigin, allowHeaders);
    }
  },
};
