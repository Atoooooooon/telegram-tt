import { fetchCustomerServiceCloudRecord } from '../lib/customer-service-cloud-sync.mjs';
import { sendJson } from '../lib/http.mjs';

export default {
  method: 'GET',
  path: '/api/customer-service-cloud/config',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, log,
    } = ctx;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = String(url.searchParams.get('token') || '').trim();
    const currentUserId = String(url.searchParams.get('currentUserId') || '').trim() || undefined;

    if (!token) {
      sendJson(res, 400, { error: 'token is required' }, allowOrigin, allowHeaders);
      return;
    }

    try {
      const record = await fetchCustomerServiceCloudRecord(log, token, currentUserId);
      sendJson(res, 200, { ok: true, record }, allowOrigin, allowHeaders);
    } catch (error) {
      sendJson(res, 503, { error: String(error) }, allowOrigin, allowHeaders);
    }
  },
};
