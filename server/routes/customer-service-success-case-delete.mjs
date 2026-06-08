import { deleteCustomerServiceSuccessCase } from '../lib/customer-service-success-cases.mjs';
import { parseBody, readBody, sendJson } from '../lib/http.mjs';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export default {
  method: 'DELETE',
  path: '/api/customer-service/success-case',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, maxBodyBytes, log,
    } = ctx;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const bodyText = await readBody(req, maxBodyBytes);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const payload = parseBody(bodyText, contentType);
    const id = url.searchParams.get('id') || payload.id;

    try {
      const result = await deleteCustomerServiceSuccessCase(log, id);
      sendJson(res, 200, { ok: true, ...result }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      const statusCode = message.includes('Redis is not configured') ? 503 : 400;

      log('Customer service success case delete failed', {
        error: message,
      });
      sendJson(res, statusCode, { ok: false, error: message }, allowOrigin, allowHeaders);
    }
  },
};
