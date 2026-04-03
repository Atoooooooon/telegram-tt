#!/usr/bin/env node
import 'dotenv/config';
import Fastify from 'fastify';

import { sendJson, setCorsHeaders } from './lib/http.mjs';
import { createOncallService } from './lib/oncall-service.mjs';
import baiduOcrRoute from './routes/baidu-ocr.mjs';
import customerServiceCloudConfigGetRoute from './routes/customer-service-cloud-config-get.mjs';
import customerServiceCloudConfigPostRoute from './routes/customer-service-cloud-config-post.mjs';
import oncallCaseStatusRoute from './routes/oncall-case-status.mjs';
import oncallCasesRoute from './routes/oncall-cases.mjs';
import oncallStaffReplyRoute from './routes/oncall-staff-reply.mjs';
import oncallUsefulMessageRoute from './routes/oncall-useful-message.mjs';

const PORT = Number(process.env.PROXY_PORT || process.env.OCR_PROXY_PORT || 8787);
const ALLOW_ORIGIN = process.env.PROXY_ALLOW_ORIGIN || process.env.OCR_ALLOW_ORIGIN || '*';
const ALLOW_HEADERS = process.env.PROXY_ALLOW_HEADERS || process.env.OCR_ALLOW_HEADERS || 'content-type';
const MAX_BODY_BYTES = Number(process.env.PROXY_MAX_BODY_BYTES || process.env.OCR_MAX_BODY_BYTES || 6_000_000);
const LOG_ENABLED = process.env.PROXY_LOG === '1' || process.env.OCR_LOG === '1';
const HOST = process.env.PROXY_HOST || process.env.OCR_HOST || '0.0.0.0';

const oncallService = await createOncallService(log);
const routes = [
  baiduOcrRoute,
  customerServiceCloudConfigGetRoute,
  customerServiceCloudConfigPostRoute,
  oncallUsefulMessageRoute,
  oncallStaffReplyRoute,
  oncallCaseStatusRoute,
  oncallCasesRoute,
];

function log(message, extra) {
  if (!LOG_ENABLED) return;
  // eslint-disable-next-line no-console
  console.log('[API Proxy]', message, extra || '');
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}

function applyCorsHeaders(reply) {
  reply.header('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  reply.header('Access-Control-Allow-Methods', 'POST,OPTIONS,GET');
  reply.header('Access-Control-Allow-Headers', ALLOW_HEADERS);
}

const app = Fastify({
  bodyLimit: MAX_BODY_BYTES,
  disableRequestLogging: true,
  logger: false,
});

app.removeAllContentTypeParsers();

function stringBodyParser(_request, body, done) {
  done(null, body);
}

app.addContentTypeParser('application/json', { parseAs: 'string' }, stringBodyParser);
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, stringBodyParser);
app.addContentTypeParser('text/plain', { parseAs: 'string' }, stringBodyParser);
app.addContentTypeParser('*', { parseAs: 'string' }, stringBodyParser);

app.addHook('onRequest', async (request, reply) => {
  applyCorsHeaders(reply);

  if (request.method === 'OPTIONS') {
    return reply.code(204).send();
  }
});

app.get('/healthz', async (_request, reply) => {
  applyCorsHeaders(reply);
  return reply.code(200).send({ ok: true });
});

for (const route of routes) {
  app.route({
    method: route.method,
    url: route.path,
    handler: async (request, reply) => {
      reply.hijack();
      request.raw.rawBodyText = typeof request.body === 'string' ? request.body : '';

      try {
        await route.handler(request.raw, reply.raw, {
          allowOrigin: ALLOW_ORIGIN,
          allowHeaders: ALLOW_HEADERS,
          maxBodyBytes: MAX_BODY_BYTES,
          log,
          oncallService,
        });
      } catch (error) {
        log('Unhandled route error', {
          method: request.method,
          path: request.url,
          error: getErrorMessage(error),
        });

        if (!reply.raw.writableEnded) {
          sendJson(reply.raw, 500, { error: 'Proxy error', detail: getErrorMessage(error) }, ALLOW_ORIGIN, ALLOW_HEADERS);
        }
      }

      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    },
  });
}

app.setNotFoundHandler(async (request, reply) => {
  applyCorsHeaders(reply);
  return reply.code(404).send({ error: 'Not found' });
});

app.setErrorHandler(async (error, request, reply) => {
  log('Fastify request error', {
    method: request.method,
    path: request.url,
    error: getErrorMessage(error),
  });

  if (reply.sent) {
    return;
  }

  applyCorsHeaders(reply);
  return reply.code(500).send({ error: 'Proxy error', detail: getErrorMessage(error) });
});

let isShuttingDown = false;

async function shutdown(signal, exitCode = 0) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  log('Shutting down API Proxy', { signal, exitCode });

  try {
    await oncallService.close();
  } catch (error) {
    log('Failed to close oncall service cleanly', { error: getErrorMessage(error) });
  }

  try {
    await app.close();
  } catch (error) {
    log('Failed to close Fastify cleanly', { error: getErrorMessage(error) });
  }

  process.exit(exitCode);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('unhandledRejection', (error) => {
  log('Unhandled promise rejection', { error: getErrorMessage(error) });
});

process.on('uncaughtException', (error) => {
  log('Uncaught exception', { error: getErrorMessage(error) });
  void shutdown('uncaughtException', 1);
});

await app.listen({ port: PORT, host: HOST });

// eslint-disable-next-line no-console
console.log(`[API Proxy] listening on http://localhost:${PORT}`);
