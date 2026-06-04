import { saveCustomerServiceCloudRecord } from '../lib/customer-service-cloud-sync.mjs';
import { parseBody, readBody, sendJson } from '../lib/http.mjs';

export default {
  method: 'POST',
  path: '/api/customer-service-cloud/config',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, maxBodyBytes, log,
    } = ctx;

    const bodyText = await readBody(req, maxBodyBytes);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const payload = parseBody(bodyText, contentType);

    const token = typeof payload.token === 'string' ? payload.token.trim() : '';
    const ownerId = typeof payload.ownerId === 'string' ? payload.ownerId.trim() : '';

    if (!token) {
      sendJson(res, 400, { error: 'token is required' }, allowOrigin, allowHeaders);
      return;
    }

    if (!ownerId) {
      sendJson(res, 400, { error: 'ownerId is required' }, allowOrigin, allowHeaders);
      return;
    }

    try {
      const result = await saveCustomerServiceCloudRecord(log, token, {
        ownerId,
        settings: payload.settings,
      });
      sendJson(res, 200, result, allowOrigin, allowHeaders);
    } catch (error) {
      sendJson(res, 403, { error: String(error) }, allowOrigin, allowHeaders);
    }
  },
};
