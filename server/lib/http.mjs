export function setCorsHeaders(res, allowOrigin, allowHeaders) {
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS,GET,DELETE');
  res.setHeader('Access-Control-Allow-Headers', allowHeaders);
}

export function sendJson(res, statusCode, payload, allowOrigin, allowHeaders) {
  setCorsHeaders(res, allowOrigin, allowHeaders);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return false;
}

export function readBody(req, maxBytes) {
  if (typeof req.rawBodyText === 'string') {
    return Promise.resolve(req.rawBodyText);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

export function parseBody(bodyText, contentType) {
  if (!bodyText) return {};
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(bodyText);
    return Object.fromEntries(params.entries());
  }
  if (contentType.includes('application/json')) {
    return JSON.parse(bodyText);
  }
  return JSON.parse(bodyText);
}
