import { fetchCustomerServiceScenarioKnowledge } from '../lib/customer-service-scenario-knowledge.mjs';
import { sendJson } from '../lib/http.mjs';

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

export default {
  method: 'GET',
  path: '/api/customer-service/scenario-knowledge',
  async handler(_req, res, ctx) {
    const {
      allowOrigin, allowHeaders, log,
    } = ctx;

    try {
      const result = await fetchCustomerServiceScenarioKnowledge(log);
      sendJson(res, 200, { ok: true, ...result }, allowOrigin, allowHeaders);
    } catch (error) {
      const message = getErrorMessage(error);
      log('Customer service scenario knowledge fetch failed', {
        error: message,
      });
      sendJson(res, 503, {
        ok: false,
        error: message,
        source: 'empty',
        unavailable: true,
      }, allowOrigin, allowHeaders);
    }
  },
};
