import { sendJson } from '../lib/http.mjs';

export default {
  method: 'GET',
  path: '/api/oncall/cases',
  async handler(req, res, ctx) {
    const {
      allowOrigin, allowHeaders, oncallService,
    } = ctx;

    if (!oncallService) {
      sendJson(res, 503, { error: 'Oncall service unavailable' }, allowOrigin, allowHeaders);
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const chatId = url.searchParams.get('chatId') || undefined;

    const cases = await oncallService.listCases(chatId);
    sendJson(res, 200, { ok: true, cases }, allowOrigin, allowHeaders);
  },
};
