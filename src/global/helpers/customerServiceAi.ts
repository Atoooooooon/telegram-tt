import type {
  CustomerServiceAiChatContentPart,
  CustomerServiceAiChatImagePart,
  CustomerServiceAiChatMessage,
  CustomerServiceExternalAiProfile,
  CustomerServiceSettings,
} from '../types/customerServiceV2';
import {
  type ApiDocument,
  ApiMediaFormat,
  type ApiMessage,
  type ApiPhoto,
} from '../../api/types';

import { blobToDataUri, fetchBlob, preloadImage } from '../../util/files';
import * as mediaLoader from '../../util/mediaLoader';
import {
  DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT,
  normalizeCustomerServiceExternalSettings,
} from './customerServiceV2Settings';
import {
  getDocumentMediaHash,
  getMessageDocument,
  getMessagePhoto,
  getPhotoMediaHash,
  hasMediaLocalBlobUrl,
  isDocumentPhoto,
} from './messageMedia';

export type CustomerServiceAiProfileSelection = {
  profileId?: string;
  businessKey?: string;
  includeDisabled?: boolean;
};

export type CustomerServiceAiChatResult = {
  ok: boolean;
  content?: string;
  rawContent?: string;
  model?: string;
  usage?: unknown;
  finishReason?: string;
  error?: string;
};

export type CustomerServiceAiChatRequestOptions = {
  temperature?: number;
  maxTokens?: number;
  responseMimeType?: string;
};

export type CustomerServiceScenarioKnowledgeRecord = {
  format: 'markdown';
  content: string;
  updatedAt?: number;
};

export type CustomerServiceScenarioKnowledgeResult = {
  ok: boolean;
  record?: CustomerServiceScenarioKnowledgeRecord;
  source?: string;
  unavailable?: boolean;
  error?: string;
};

type AiChatResponse = {
  ok?: boolean;
  content?: string;
  model?: string;
  usage?: unknown;
  finishReason?: string;
  error?: string;
  detail?: string;
};

type AiChatRequestAttempt = {
  response: Response;
  responseText: string;
  data?: AiChatResponse;
};

type ScenarioKnowledgeRequestAttempt = {
  response: Response;
  responseText: string;
  data?: CustomerServiceScenarioKnowledgeResult;
};

const AI_CHAT_PROXY_PATH = '/api/customer-service/ai/chat';
const LOCAL_AI_CHAT_PROXY_URL = 'http://localhost:8787/api/customer-service/ai/chat';
const SCENARIO_KNOWLEDGE_PROXY_PATH = '/api/customer-service/scenario-knowledge';
const LOCAL_SCENARIO_KNOWLEDGE_PROXY_URL = 'http://localhost:8787/api/customer-service/scenario-knowledge';
const AI_CHAT_REQUEST_TIMEOUT_MS = 45_000;
const SCENARIO_KNOWLEDGE_CACHE_TTL_MS = 30_000;
const DEFAULT_AI_IMAGE_MAX_EDGE = 1024;
const DEFAULT_AI_IMAGE_QUALITY = 0.76;
const DEFAULT_MAX_AI_IMAGES = 2;
const MAX_AI_IMAGE_BASE64_LENGTH = 1_000_000;
const MAX_AI_CHAT_REQUEST_BODY_LENGTH = 5_000_000;

let scenarioKnowledgeCache:
  | {
    fetchedAt: number;
    result: CustomerServiceScenarioKnowledgeResult;
  }
  | undefined;

type BuildAiImagePartsOptions = {
  maxImages?: number;
  maxEdge?: number;
  quality?: number;
};

function tryParseAiChatResponse(text: string): AiChatResponse | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as AiChatResponse;
  } catch {
    return undefined;
  }
}

function tryParseScenarioKnowledgeResponse(text: string): CustomerServiceScenarioKnowledgeResult | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as CustomerServiceScenarioKnowledgeResult;
  } catch {
    return undefined;
  }
}

function getMessageImageMedia(message: ApiMessage): ApiPhoto | ApiDocument | undefined {
  const photo = getMessagePhoto(message);
  if (photo) {
    return photo;
  }

  const document = getMessageDocument(message);
  return document && isDocumentPhoto(document) ? document : undefined;
}

async function resolveImageMediaBlobUrl(media: ApiPhoto | ApiDocument): Promise<string | undefined> {
  if (hasMediaLocalBlobUrl(media)) {
    if ('blobUrl' in media && media.blobUrl) return media.blobUrl;
    if ('previewBlobUrl' in media && media.previewBlobUrl) return media.previewBlobUrl;
  }

  if (media.mediaType === 'photo') {
    const mediaHash = getPhotoMediaHash(media, 'full');
    return mediaHash ? mediaLoader.fetch(mediaHash, ApiMediaFormat.BlobUrl) : undefined;
  }

  const mediaHash = media.id ? getDocumentMediaHash(media, 'full') : undefined;
  return mediaHash ? mediaLoader.fetch(mediaHash, ApiMediaFormat.BlobUrl) : undefined;
}

function getImageMimeType(media: ApiPhoto | ApiDocument, blob: Blob) {
  if (blob.type.startsWith('image/')) {
    return blob.type;
  }

  if (media.mediaType === 'document' && media.mimeType.startsWith('image/')) {
    return media.mimeType;
  }

  return 'image/jpeg';
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | undefined> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob || undefined), mimeType, quality);
  });
}

async function compressImageBlobForAi(
  blob: Blob,
  options: Required<Pick<BuildAiImagePartsOptions, 'maxEdge' | 'quality'>>,
): Promise<{ data: string; mimeType: string } | undefined> {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await preloadImage(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return undefined;
    }

    const scale = Math.min(1, options.maxEdge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      return undefined;
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const qualityCandidates = [options.quality, 0.68, 0.58, 0.48]
      .filter((quality, index, candidates) => quality > 0 && candidates.indexOf(quality) === index);
    for (const quality of qualityCandidates) {
      const compressedBlob = await canvasToBlob(canvas, 'image/jpeg', quality);
      if (!compressedBlob) {
        continue;
      }

      const dataUri = await blobToDataUri(compressedBlob);
      const base64 = dataUri.split(',')[1];
      if (base64 && base64.length <= MAX_AI_IMAGE_BASE64_LENGTH) {
        return {
          data: base64,
          mimeType: 'image/jpeg',
        };
      }
    }

    return undefined;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function buildCustomerServiceAiImagePartsFromMessages(
  messages: ApiMessage[],
  options: BuildAiImagePartsOptions = {},
): Promise<CustomerServiceAiChatImagePart[]> {
  const maxImages = Math.max(0, Math.floor(options.maxImages ?? DEFAULT_MAX_AI_IMAGES));
  if (!maxImages) {
    return [];
  }

  const imageParts: CustomerServiceAiChatImagePart[] = [];
  const maxEdge = options.maxEdge ?? DEFAULT_AI_IMAGE_MAX_EDGE;
  const quality = options.quality ?? DEFAULT_AI_IMAGE_QUALITY;

  for (const message of messages) {
    if (imageParts.length >= maxImages) {
      break;
    }

    const media = getMessageImageMedia(message);
    if (!media) {
      continue;
    }

    try {
      const blobUrl = await resolveImageMediaBlobUrl(media);
      if (!blobUrl) {
        continue;
      }

      const blob = await fetchBlob(blobUrl);
      const compressed = await compressImageBlobForAi(blob, { maxEdge, quality });
      if (compressed) {
        imageParts.push({
          type: 'image',
          data: compressed.data,
          mimeType: compressed.mimeType,
        });
        continue;
      }

      const mimeType = getImageMimeType(media, blob);
      const dataUri = await blobToDataUri(blob);
      const base64 = dataUri.split(',')[1];
      if (base64 && base64.length <= MAX_AI_IMAGE_BASE64_LENGTH) {
        imageParts.push({
          type: 'image',
          data: base64,
          mimeType,
        });
      }
    } catch {
      // Ignore individual media failures; text-only recommendation is still useful.
    }
  }

  return imageParts;
}

export function buildCustomerServiceAiMultimodalContent(
  text: string,
  imageParts: CustomerServiceAiChatImagePart[],
): string | CustomerServiceAiChatContentPart[] {
  if (!imageParts.length) {
    return text;
  }

  return [
    { type: 'text', text },
    ...imageParts,
  ];
}

function getAiProxyResponseError(response: Response, text: string, data?: AiChatResponse) {
  if (data?.detail || data?.error) {
    return data.detail || data.error;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/html') || text.trim().startsWith('<!DOCTYPE')) {
    return 'AI 代理接口没有返回 JSON。请确认 dev server 已重启，并且 /api/customer-service 已代理到本地 API Proxy。';
  }

  return `AI request failed with HTTP ${response.status}`;
}

function isLocalDevelopmentHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

function shouldRetryWithLocalProxy(attempt: AiChatRequestAttempt) {
  const contentType = attempt.response.headers.get('content-type') || '';
  return isLocalDevelopmentHost()
    && !attempt.response.ok
    && !attempt.data
    && (contentType.includes('text/html') || attempt.responseText.trim().startsWith('<!DOCTYPE'));
}

function getNetworkAiRequestError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|load failed|networkerror/i.test(message)) {
    return 'AI 请求没有连上本地 API Proxy，或图片请求体过大导致连接被断开。已降低推荐图片大小，请重试；如果仍失败，请确认 8787 代理正常运行。';
  }

  return error instanceof Error ? error.message : 'AI request failed.';
}

async function postCustomerServiceAiChat(url: string, body: string): Promise<AiChatRequestAttempt> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, AI_CHAT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
      signal: controller.signal,
    });
    const responseText = await response.text();

    return {
      response,
      responseText,
      data: tryParseAiChatResponse(responseText),
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getCustomerServiceScenarioKnowledge(
  url: string,
): Promise<ScenarioKnowledgeRequestAttempt> {
  const response = await fetch(url);
  const responseText = await response.text();

  return {
    response,
    responseText,
    data: tryParseScenarioKnowledgeResponse(responseText),
  };
}

function shouldRetryScenarioKnowledgeWithLocalProxy(attempt: ScenarioKnowledgeRequestAttempt) {
  const contentType = attempt.response.headers.get('content-type') || '';
  return isLocalDevelopmentHost()
    && !attempt.response.ok
    && !attempt.data
    && (contentType.includes('text/html') || attempt.responseText.trim().startsWith('<!DOCTYPE'));
}

export async function fetchCustomerServiceScenarioKnowledge(
  force = false,
): Promise<CustomerServiceScenarioKnowledgeResult> {
  const cachedScenarioKnowledge = scenarioKnowledgeCache;
  const hasFreshCache = !force
    && cachedScenarioKnowledge
    && Date.now() - cachedScenarioKnowledge.fetchedAt < SCENARIO_KNOWLEDGE_CACHE_TTL_MS;

  if (hasFreshCache) {
    return cachedScenarioKnowledge.result;
  }

  try {
    let attempt: ScenarioKnowledgeRequestAttempt;
    try {
      attempt = await getCustomerServiceScenarioKnowledge(SCENARIO_KNOWLEDGE_PROXY_PATH);
    } catch (error) {
      if (!isLocalDevelopmentHost()) {
        throw error;
      }

      attempt = await getCustomerServiceScenarioKnowledge(LOCAL_SCENARIO_KNOWLEDGE_PROXY_URL);
    }

    const retryAttempt = shouldRetryScenarioKnowledgeWithLocalProxy(attempt)
      ? await getCustomerServiceScenarioKnowledge(LOCAL_SCENARIO_KNOWLEDGE_PROXY_URL)
      : undefined;
    const {
      response,
      data,
    } = retryAttempt || attempt;

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
        source: data?.source,
        unavailable: true,
      };
    }

    scenarioKnowledgeCache = {
      fetchedAt: Date.now(),
      result: data,
    };

    return data;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      unavailable: true,
    };
  }
}

export async function saveCustomerServiceScenarioKnowledge(
  content: string,
): Promise<CustomerServiceScenarioKnowledgeResult> {
  if (typeof fetch === 'undefined') {
    return { ok: false, error: 'fetch is not available' };
  }

  try {
    const response = await fetch(SCENARIO_KNOWLEDGE_PROXY_PATH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });
    const data = await response.json();

    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || `HTTP ${response.status}`,
        unavailable: true,
      };
    }

    scenarioKnowledgeCache = undefined;

    return {
      ok: true,
      record: {
        format: 'markdown',
        content,
        updatedAt: data.updatedAt,
      },
      source: 'redis',
      unavailable: false,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      unavailable: true,
    };
  }
}

export function getCustomerServiceAiProfiles(
  settings?: CustomerServiceSettings,
): CustomerServiceExternalAiProfile[] {
  return normalizeCustomerServiceExternalSettings(settings?.external).aiProfiles || [];
}

export function selectCustomerServiceAiProfile(
  settings?: CustomerServiceSettings,
  selection?: CustomerServiceAiProfileSelection,
): CustomerServiceExternalAiProfile | undefined {
  const profiles = getCustomerServiceAiProfiles(settings);
  const candidates = selection?.includeDisabled
    ? profiles
    : profiles.filter((profile) => profile.enabled);

  if (!candidates.length) {
    return undefined;
  }

  const profileId = selection?.profileId?.trim();
  if (profileId) {
    const matched = candidates.find((profile) => profile.id === profileId);
    if (matched) {
      return matched;
    }
  }

  const businessKey = selection?.businessKey?.trim();
  if (businessKey) {
    const matched = candidates.find((profile) => (
      profile.role === 'business' && profile.businessKey === businessKey
    ));
    if (matched) {
      return matched;
    }

    return undefined;
  }

  const defaultProfileId = normalizeCustomerServiceExternalSettings(settings?.external).defaultAiProfileId;
  return candidates.find((profile) => profile.id === defaultProfileId)
    || candidates.find((profile) => profile.role === 'general')
    || candidates[0];
}

export function getCustomerServiceAiSystemPrompt(profile?: CustomerServiceExternalAiProfile): string {
  return profile?.systemPrompt?.trim() || DEFAULT_CUSTOMER_SERVICE_AI_SYSTEM_PROMPT;
}

export function isCustomerServiceAiProfileReady(profile?: CustomerServiceExternalAiProfile): boolean {
  return Boolean(
    profile?.enabled
    && (profile.provider === 'gemini' || profile.apiKey.trim())
    && profile.baseUrl.trim()
    && profile.model.trim(),
  );
}

export async function requestCustomerServiceAiChat(
  profile: CustomerServiceExternalAiProfile,
  messages: CustomerServiceAiChatMessage[],
  options: CustomerServiceAiChatRequestOptions = {},
): Promise<CustomerServiceAiChatResult> {
  if (!isCustomerServiceAiProfileReady(profile)) {
    return {
      ok: false,
      error: 'AI profile is not enabled or missing API configuration.',
    };
  }

  try {
    const body = JSON.stringify({
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      model: profile.model,
      temperature: options.temperature ?? profile.temperature,
      maxTokens: options.maxTokens ?? profile.maxTokens,
      responseMimeType: options.responseMimeType,
      messages,
    });
    if (body.length > MAX_AI_CHAT_REQUEST_BODY_LENGTH) {
      return {
        ok: false,
        error: 'AI 推荐请求内容过大，已取消发送。请减少图片数量或使用更小的截图后重新生成。',
      };
    }

    let attempt: AiChatRequestAttempt;
    try {
      attempt = await postCustomerServiceAiChat(AI_CHAT_PROXY_PATH, body);
    } catch (error) {
      if (!isLocalDevelopmentHost()) {
        throw error;
      }

      attempt = await postCustomerServiceAiChat(LOCAL_AI_CHAT_PROXY_URL, body);
    }

    const retryAttempt = shouldRetryWithLocalProxy(attempt)
      ? await postCustomerServiceAiChat(LOCAL_AI_CHAT_PROXY_URL, body)
      : undefined;
    const {
      response,
      responseText,
      data,
    } = retryAttempt || attempt;

    if (!response.ok || !data?.ok || !data.content) {
      return {
        ok: false,
        error: getAiProxyResponseError(response, responseText, data),
        rawContent: data?.detail || data?.error || responseText,
      };
    }

    return {
      ok: true,
      content: data.content,
      model: data.model,
      usage: data.usage,
      finishReason: data.finishReason,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.name === 'AbortError'
        ? 'AI 请求超时，请确认本地 API Proxy 正常运行。'
        : getNetworkAiRequestError(error),
    };
  }
}
