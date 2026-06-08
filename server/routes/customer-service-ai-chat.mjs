import { parseBody, readBody, sendJson } from '../lib/http.mjs';

const MAX_ERROR_DETAIL_LENGTH = 1200;
const MAX_MESSAGES = 30;
const MAX_MESSAGE_IMAGES = 4;
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toOptionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeProvider(value) {
  const provider = toTrimmedString(value);
  if (provider === 'deepseek' || provider === 'openai-compatible' || provider === 'gemini') {
    return provider;
  }

  return '';
}

function redactSecret(text, secret) {
  if (!secret || !text) {
    return text;
  }

  return String(text).split(secret).join('[redacted]');
}

function truncateDetail(text) {
  if (!text) {
    return '';
  }

  return text.length > MAX_ERROR_DETAIL_LENGTH
    ? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}...`
    : text;
}

function resolveChatCompletionsUrl(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid AI base URL protocol');
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath.endsWith('/chat/completions')) {
    url.pathname = `${normalizedPath}/chat/completions`.replace(/\/{2,}/g, '/');
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

function resolveGeminiGenerateContentUrl(baseUrl, model) {
  const url = new URL(baseUrl || DEFAULT_GEMINI_BASE_URL);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Invalid Gemini base URL protocol');
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  if (!normalizedPath.endsWith(':generateContent')) {
    const modelName = model.replace(/^models\//, '');
    if (normalizedPath.includes('/models/')) {
      url.pathname = `${normalizedPath}:generateContent`;
    } else {
      url.pathname = `${normalizedPath}/models/${modelName}:generateContent`.replace(/\/{2,}/g, '/');
    }
  }
  url.hash = '';
  return url.toString();
}

function stripBase64DataUri(value, fallbackMimeType) {
  const trimmed = toTrimmedString(value);
  const match = trimmed.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!match) {
    return {
      data: trimmed,
      mimeType: fallbackMimeType,
    };
  }

  return {
    data: match[2].trim(),
    mimeType: match[1].trim() || fallbackMimeType,
  };
}

function normalizeContentParts(rawContent, state) {
  if (typeof rawContent === 'string') {
    const text = toTrimmedString(rawContent);
    return text ? [{ type: 'text', text }] : [];
  }

  if (!Array.isArray(rawContent)) {
    return [];
  }

  return rawContent.reduce((parts, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return parts;
    }

    const type = toTrimmedString(item.type);
    if (type === 'text' || typeof item.text === 'string') {
      const text = toTrimmedString(item.text ?? item.content);
      if (text) {
        parts.push({ type: 'text', text });
      }
      return parts;
    }

    if (type === 'image' && state.imageCount < MAX_MESSAGE_IMAGES) {
      const rawMimeType = toTrimmedString(item.mimeType ?? item.mime_type) || 'image/jpeg';
      const { data, mimeType } = stripBase64DataUri(item.data ?? item.base64, rawMimeType);
      if (data && mimeType.toLowerCase().startsWith('image/')) {
        state.imageCount += 1;
        parts.push({ type: 'image', data, mimeType });
      }
    }

    return parts;
  }, []);
}

function normalizeMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return undefined;
  }

  const state = { imageCount: 0 };
  const messages = rawMessages.slice(-MAX_MESSAGES).reduce((result, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return result;
    }

    const role = item.role === 'assistant' || item.role === 'system' ? item.role : 'user';
    const content = normalizeContentParts(item.content, state);
    if (!content.length) {
      return result;
    }

    result.push({ role, content });
    return result;
  }, []);

  return messages.length ? messages : undefined;
}

function getMessageTextContent(message) {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function buildOpenAiCompatibleMessageContent(message) {
  const hasImages = message.content.some((part) => part.type === 'image');
  if (!hasImages) {
    return getMessageTextContent(message);
  }

  return message.content.map((part) => {
    if (part.type === 'text') {
      return {
        type: 'text',
        text: part.text,
      };
    }

    return {
      type: 'image_url',
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`,
      },
    };
  });
}

function buildOpenAiCompatibleRequestBody(payload, messages) {
  const body = {
    model: toTrimmedString(payload.model),
    messages: messages.map((message) => ({
      role: message.role,
      content: buildOpenAiCompatibleMessageContent(message),
    })),
    stream: false,
  };
  const temperature = toOptionalNumber(payload.temperature);
  const maxTokens = toOptionalNumber(payload.maxTokens ?? payload.max_tokens);

  if (temperature !== undefined) {
    body.temperature = temperature;
  }
  if (maxTokens !== undefined && maxTokens > 0) {
    body.max_tokens = Math.floor(maxTokens);
  }

  return body;
}

function buildGeminiParts(message) {
  return message.content.map((part) => {
    if (part.type === 'text') {
      return {
        text: part.text,
      };
    }

    return {
      inline_data: {
        mime_type: part.mimeType,
        data: part.data,
      },
    };
  });
}

function buildGeminiRequestBody(payload, messages) {
  const body = {
    contents: [],
  };

  const systemParts = [];
  messages.forEach((message) => {
    const parts = buildGeminiParts(message);
    if (!parts.length) {
      return;
    }

    if (message.role === 'system') {
      systemParts.push(...parts.filter((part) => part.text));
      return;
    }

    body.contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  });

  if (systemParts.length) {
    body.system_instruction = {
      parts: systemParts,
    };
  }

  if (!body.contents.length && systemParts.length) {
    body.contents.push({
      role: 'user',
      parts: systemParts,
    });
  }

  const temperature = toOptionalNumber(payload.temperature);
  const maxTokens = toOptionalNumber(payload.maxTokens ?? payload.max_tokens);
  const responseMimeType = toTrimmedString(payload.responseMimeType ?? payload.response_mime_type);
  const generationConfig = {};

  if (temperature !== undefined) {
    generationConfig.temperature = temperature;
  }
  if (maxTokens !== undefined && maxTokens > 0) {
    generationConfig.maxOutputTokens = Math.floor(maxTokens);
  }
  if (responseMimeType) {
    generationConfig.responseMimeType = responseMimeType;
  }
  if (Object.keys(generationConfig).length) {
    body.generationConfig = generationConfig;
  }

  return body;
}

function assertGeminiRequestBody(body) {
  if (!Array.isArray(body.contents) || !body.contents.length) {
    throw new Error('Missing Gemini contents');
  }

  const hasUsablePart = body.contents.some((content) => (
    Array.isArray(content?.parts)
    && content.parts.some((part) => (
      toTrimmedString(part?.text)
      || toTrimmedString(part?.inline_data?.data)
      || toTrimmedString(part?.inlineData?.data)
    ))
  ));

  if (!hasUsablePart) {
    throw new Error('Missing Gemini content parts');
  }
}

function extractOpenAiCompatibleContent(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  const content = choice?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function extractGeminiContent(data) {
  const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractFinishReason(provider, data) {
  if (provider === 'gemini') {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : undefined;
    return toTrimmedString(candidate?.finishReason);
  }

  const choice = Array.isArray(data?.choices) ? data.choices[0] : undefined;
  return toTrimmedString(choice?.finish_reason);
}

export default {
  method: 'POST',
  path: '/api/customer-service/ai/chat',
  async handler(req, res, ctx) {
    const { allowOrigin, allowHeaders, maxBodyBytes, log } = ctx;
    let bodyText;
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

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJson(res, 400, { error: 'Invalid request body' }, allowOrigin, allowHeaders);
      return;
    }

    const provider = normalizeProvider(payload.provider);
    const apiKey = toTrimmedString(payload.apiKey)
      || (provider === 'gemini'
        ? toTrimmedString(
          process.env.GEMINI_API_KEY
          || process.env.GOOGLE_API_KEY
          || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        )
        : '');
    const baseUrl = toTrimmedString(payload.baseUrl)
      || (provider === 'gemini' ? DEFAULT_GEMINI_BASE_URL : '');
    const model = toTrimmedString(payload.model);
    const messages = normalizeMessages(payload.messages);

    if (!provider) {
      sendJson(res, 400, { error: 'Missing or invalid AI provider' }, allowOrigin, allowHeaders);
      return;
    }
    if (!apiKey) {
      sendJson(res, 400, { error: 'Missing AI API key' }, allowOrigin, allowHeaders);
      return;
    }
    if (!baseUrl) {
      sendJson(res, 400, { error: 'Missing AI base URL' }, allowOrigin, allowHeaders);
      return;
    }
    if (!model) {
      sendJson(res, 400, { error: 'Missing AI model' }, allowOrigin, allowHeaders);
      return;
    }
    if (!messages) {
      sendJson(res, 400, { error: 'Missing AI messages' }, allowOrigin, allowHeaders);
      return;
    }

    let url;
    let response;
    try {
      if (provider === 'gemini') {
        url = resolveGeminiGenerateContentUrl(baseUrl, model);
        const geminiBody = buildGeminiRequestBody({ ...payload, model }, messages);
        assertGeminiRequestBody(geminiBody);
        log('Customer service AI request', {
          provider,
          model,
          messages: messages.length,
          images: messages.reduce((count, message) => (
            count + message.content.filter((part) => part.type === 'image').length
          ), 0),
          host: new URL(url).host,
        });

        response = await fetch(url, {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(geminiBody),
        });
      } else {
        url = resolveChatCompletionsUrl(baseUrl);
        log('Customer service AI request', {
          provider,
          model,
          messages: messages.length,
          host: new URL(url).host,
        });

        response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(buildOpenAiCompatibleRequestBody({ ...payload, model }, messages)),
        });
      }
    } catch (error) {
      const detail = String(error);
      const isConfigurationError = detail.includes('Invalid AI base URL')
        || detail.includes('Invalid Gemini base URL')
        || detail.includes('Missing Gemini');
      sendJson(res, isConfigurationError ? 400 : 502, {
        error: isConfigurationError ? 'Invalid AI request configuration' : 'AI service request failed',
        detail: truncateDetail(redactSecret(detail, apiKey)),
      }, allowOrigin, allowHeaders);
      return;
    }

    const responseText = await response.text();
    if (!response.ok) {
      sendJson(res, 502, {
        error: 'AI service request failed',
        status: response.status,
        detail: truncateDetail(redactSecret(responseText, apiKey)),
      }, allowOrigin, allowHeaders);
      return;
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (error) {
      sendJson(res, 502, { error: 'AI service returned invalid JSON' }, allowOrigin, allowHeaders);
      return;
    }

    const content = provider === 'gemini'
      ? extractGeminiContent(data)
      : extractOpenAiCompatibleContent(data);
    if (!content) {
      sendJson(res, 502, { error: 'AI service returned empty content' }, allowOrigin, allowHeaders);
      return;
    }

    sendJson(res, 200, {
      ok: true,
      content,
      model: data.model || model,
      usage: data.usage || data.usageMetadata,
      finishReason: extractFinishReason(provider, data),
    }, allowOrigin, allowHeaders);
  },
};
