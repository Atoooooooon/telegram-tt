import { parseBody, readBody, sendJson, toBoolean } from '../lib/http.mjs';

const tokenCache = new Map();

async function fetchBaiduAccessToken(apiKey, secretKey) {
  const now = Date.now();
  const cacheKey = `${apiKey}:${secretKey}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${
    encodeURIComponent(apiKey)
  }&client_secret=${encodeURIComponent(secretKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Baidu access_token request failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Baidu access_token missing: ${data.error || 'unknown error'}`);
  }

  const expiresIn = Number(data.expires_in || 0);
  const accessToken = data.access_token;
  const expiresAt = now + (Number.isFinite(expiresIn) ? expiresIn * 1000 : 0);
  tokenCache.set(cacheKey, { accessToken, expiresAt });
  return accessToken;
}

export default {
  method: 'POST',
  path: '/api/ocr/baidu',
  async handler(req, res, ctx) {
    const { allowOrigin, allowHeaders, maxBodyBytes, log } = ctx;
    let bodyText = '';
    try {
      bodyText = await readBody(req, maxBodyBytes);
    } catch (error) {
      sendJson(res, 413, { error: String(error) }, allowOrigin, allowHeaders);
      return;
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    let payload;
    try {
      payload = parseBody(bodyText, contentType);
    } catch (error) {
      sendJson(res, 400, { error: 'Invalid request body', detail: String(error) }, allowOrigin, allowHeaders);
      return;
    }

    const image = payload.image || payload.imageBase64;
    if (!image) {
      sendJson(res, 400, { error: 'Missing image field' }, allowOrigin, allowHeaders);
      return;
    }

    const languageType = payload.languageType || payload.language_type;
    const detectDirection = toBoolean(payload.detectDirection ?? payload.detect_direction);
    const detectLanguage = toBoolean(payload.detectLanguage ?? payload.detect_language);
    const paragraph = toBoolean(payload.paragraph);
    const probability = toBoolean(payload.probability);

    const accessTokenOverride = payload.accessToken;
    const apiKey = payload.apiKey;
    const secretKey = payload.secretKey;

    let accessToken = accessTokenOverride;
    if (!accessToken) {
      if (!apiKey || !secretKey) {
        sendJson(res, 400, { error: 'Missing Baidu credentials in request' }, allowOrigin, allowHeaders);
        return;
      }
      accessToken = await fetchBaiduAccessToken(apiKey, secretKey);
    }

    const params = new URLSearchParams();
    params.set('image', image);
    if (languageType) params.set('language_type', languageType);
    if (detectDirection) params.set('detect_direction', 'true');
    if (detectLanguage) params.set('detect_language', 'true');
    if (paragraph) params.set('paragraph', 'true');
    if (probability) params.set('probability', 'true');

    const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${encodeURIComponent(accessToken)}`;
    log('Baidu OCR request', { bytes: bodyText.length });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const responseText = await response.text();
    res.statusCode = response.status;
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json; charset=utf-8');
    res.end(responseText);
  },
};
