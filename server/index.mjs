#!/usr/bin/env node
import 'dotenv/config';
import http from 'http';

import { sendJson, setCorsHeaders } from './lib/http.mjs';
import { createOncallService } from './lib/oncall-service.mjs';
import baiduOcrRoute from './routes/baidu-ocr.mjs';
import customerServiceCloudConfigGetRoute from './routes/customer-service-cloud-config-get.mjs';
import customerServiceCloudConfigPostRoute from './routes/customer-service-cloud-config-post.mjs';
import oncallCasesRoute from './routes/oncall-cases.mjs';
import oncallStaffReplyRoute from './routes/oncall-staff-reply.mjs';
import oncallUsefulMessageRoute from './routes/oncall-useful-message.mjs';

const PORT = Number(process.env.PROXY_PORT || process.env.OCR_PROXY_PORT || 8787);
const ALLOW_ORIGIN = process.env.PROXY_ALLOW_ORIGIN || process.env.OCR_ALLOW_ORIGIN || '*';
const ALLOW_HEADERS = process.env.PROXY_ALLOW_HEADERS || process.env.OCR_ALLOW_HEADERS || 'content-type';
const MAX_BODY_BYTES = Number(process.env.PROXY_MAX_BODY_BYTES || process.env.OCR_MAX_BODY_BYTES || 6_000_000);
const LOG_ENABLED = process.env.PROXY_LOG === '1' || process.env.OCR_LOG === '1';

const oncallService = await createOncallService(log);
const routes = [
  baiduOcrRoute,
  customerServiceCloudConfigGetRoute,
  customerServiceCloudConfigPostRoute,
  oncallUsefulMessageRoute,
  oncallStaffReplyRoute,
  oncallCasesRoute,
];

function log(message, extra) {
  if (!LOG_ENABLED) return;
  // eslint-disable-next-line no-console
  console.log('[API Proxy]', message, extra || '');
}

function matchRoute(method, pathname) {
  return routes.find((route) => route.method === method && route.path === pathname);
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res, ALLOW_ORIGIN, ALLOW_HEADERS);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true }, ALLOW_ORIGIN, ALLOW_HEADERS);
    return;
  }

  const route = matchRoute(req.method || 'GET', url.pathname);
  if (!route) {
    sendJson(res, 404, { error: 'Not found' }, ALLOW_ORIGIN, ALLOW_HEADERS);
    return;
  }

  try {
    await route.handler(req, res, {
      allowOrigin: ALLOW_ORIGIN,
      allowHeaders: ALLOW_HEADERS,
      maxBodyBytes: MAX_BODY_BYTES,
      log,
      oncallService,
    });
  } catch (error) {
    log('Unhandled error', error);
    sendJson(res, 500, { error: 'Proxy error', detail: String(error) }, ALLOW_ORIGIN, ALLOW_HEADERS);
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[API Proxy] listening on http://localhost:${PORT}`);
});
