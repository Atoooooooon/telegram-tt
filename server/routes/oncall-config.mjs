import { sanitizeOncallConfigForResponse } from '../lib/oncall-config.mjs';
import { sendJson } from '../lib/http.mjs';

export default {
  method: 'GET',
  path: '/api/oncall/config',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, oncallService,
    } = ctx;

    if (!oncallService) {
      sendJson(res, 503, { error: 'Oncall service unavailable' }, allowOrigin, allowHeaders);
      return;
    }

    const config = await oncallService.getResolvedConfig({ force: true });
    sendJson(res, 200, {
      ok: true,
      redisKey: oncallService.getConfigKey(),
      config: sanitizeOncallConfigForResponse(config),
    }, allowOrigin, allowHeaders);
  },
};
