import { parseBody, readBody, sendJson } from '../lib/http.mjs';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function getStatusCode(message) {
  if (message.includes('Redis is not configured')) {
    return 503;
  }

  if (
    message.includes('ONCALL_TELEGRAM_BOT_TOKEN')
    || message.includes('control alert chat')
    || message.includes('required')
  ) {
    return 400;
  }

  return 500;
}

export const customerServiceSuspendGatePostRoute = {
  method: 'POST',
  path: '/api/customer-service/suspend-gate',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, maxBodyBytes, suspendService, log,
    } = ctx;

    if (!suspendService) {
      sendJson(res, 503, { ok: false, error: 'Suspend service unavailable' }, allowOrigin, allowHeaders);
      return;
    }

    const bodyText = await readBody(req, maxBodyBytes);
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    const payload = parseBody(bodyText, contentType);

    try {
      const gate = await suspendService.createGate(payload);
      sendJson(res, 200, { ok: true, gate }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      log('Customer service suspend gate create failed', { error: message });
      sendJson(res, getStatusCode(message), { ok: false, error: message }, allowOrigin, allowHeaders);
    }
  },
};

export const customerServiceSuspendGateGetRoute = {
  method: 'GET',
  path: '/api/customer-service/suspend-gate',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, suspendService, log,
    } = ctx;

    if (!suspendService) {
      sendJson(res, 503, { ok: false, error: 'Suspend service unavailable' }, allowOrigin, allowHeaders);
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const gateId = url.searchParams.get('id') || '';

    if (!gateId.trim()) {
      sendJson(res, 400, { ok: false, error: 'id is required' }, allowOrigin, allowHeaders);
      return;
    }

    try {
      const gate = await suspendService.getGate(gateId);
      if (!gate) {
        sendJson(res, 404, { ok: false, error: 'Suspend gate not found' }, allowOrigin, allowHeaders);
        return;
      }

      sendJson(res, 200, { ok: true, gate }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      log('Customer service suspend gate get failed', { error: message, gateId });
      sendJson(res, getStatusCode(message), { ok: false, error: message }, allowOrigin, allowHeaders);
    }
  },
};
