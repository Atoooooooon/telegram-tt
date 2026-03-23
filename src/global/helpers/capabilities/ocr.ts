/**
 * OCR image capability
 * Uses external OCR provider to recognize text from message images
 */

import type { ApiDocument, ApiMessage, ApiPhoto } from '../../../api/types';
import { ApiMediaFormat } from '../../../api/types';
import type { Capability } from '../../types/customerServiceV2';
import { blobToDataUri, fetchBlob } from '../../../util/files';
import * as mediaLoader from '../../../util/mediaLoader';
import {
  getDocumentMediaHash,
  getMessageDocument,
  getMessagePhoto,
  getPhotoMediaHash,
  hasMediaLocalBlobUrl,
  isDocumentPhoto,
} from '../messageMedia';

type OcrProvider = 'baidu' | 'tencent';

const DEFAULT_OCR_OUTPUT_FIELD = 'ocrText';
const DEFAULT_OCR_LINES_FIELD = 'ocrLines';
const DEFAULT_OCR_RAW_FIELD = 'ocrRaw';
const DEFAULT_BAIDU_PROXY_PATH = '/api/ocr/baidu';

function logOcr(message: string, extra?: Record<string, any>) {
  if (extra) {
    // eslint-disable-next-line no-console
    console.log('[OCR]', message, extra);
  } else {
    // eslint-disable-next-line no-console
    console.log('[OCR]', message);
  }
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function getImageBase64FromMessage(message: ApiMessage): Promise<string | undefined> {
  const photo = getMessagePhoto(message);
  const document = getMessageDocument(message);
  const documentPhoto = document && isDocumentPhoto(document) ? document : undefined;
  const media = photo || documentPhoto;

  if (!media) {
    return undefined;
  }

  const blobUrl = await resolveMediaBlobUrl(media);
  if (!blobUrl) {
    return undefined;
  }

  const blob = await fetchBlob(blobUrl);
  const dataUri = await blobToDataUri(blob);
  const base64 = dataUri.split(',')[1];
  return base64 || undefined;
}

async function resolveMediaBlobUrl(media: ApiPhoto | ApiDocument): Promise<string | undefined> {
  if (hasMediaLocalBlobUrl(media)) {
    if ('blobUrl' in media && media.blobUrl) return media.blobUrl;
    if ('previewBlobUrl' in media && media.previewBlobUrl) return media.previewBlobUrl;
  }

  if (media.mediaType === 'photo') {
    const mediaHash = getPhotoMediaHash(media, 'full');
    if (!mediaHash) {
      return undefined;
    }
    return mediaLoader.fetch(mediaHash, ApiMediaFormat.BlobUrl);
  }

  const mediaHash = media.id ? getDocumentMediaHash(media, 'full') : undefined;
  if (!mediaHash) {
    return undefined;
  }
  return mediaLoader.fetch(mediaHash, ApiMediaFormat.BlobUrl);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getUtcDateFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

async function sha256Hex(message: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available');
  }
  const data = new TextEncoder().encode(message);
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hash);
}

async function hmacSha256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto is not available');
  }
  const encoder = new TextEncoder();
  const rawKey = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return globalThis.crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function signTencentRequest(
  secretId: string,
  secretKey: string,
  timestamp: number,
  payload: string,
  host: string,
  service: string,
): Promise<string> {
  const algorithm = 'TC3-HMAC-SHA256';
  const date = getUtcDateFromTimestamp(timestamp);

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const hashedRequestPayload = await sha256Hex(payload);
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join('\n');

  const hashedCanonicalRequest = await sha256Hex(canonicalRequest);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    hashedCanonicalRequest,
  ].join('\n');

  const secretDate = await hmacSha256(`TC3${secretKey}`, date);
  const secretService = await hmacSha256(secretDate, service);
  const secretSigning = await hmacSha256(secretService, 'tc3_request');
  const signature = bufferToHex(await hmacSha256(secretSigning, stringToSign));

  return `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export const ocrImageCapability: Capability = {
  id: 'ocr_image',
  name: '图片文字识别',
  type: 'extractor',
  description: '调用外部 OCR 服务识别图片文字(百度/腾讯)',

  configSchema: {
    provider: {
      type: 'select',
      label: '服务商',
      options: ['baidu', 'tencent'],
      default: 'baidu',
    },
    outputField: {
      type: 'string',
      label: '识别文本输出字段',
      default: DEFAULT_OCR_OUTPUT_FIELD,
      placeholder: 'pipelineData 字段名',
    },
    linesField: {
      type: 'string',
      label: '行结果输出字段',
      default: DEFAULT_OCR_LINES_FIELD,
    },
    rawField: {
      type: 'string',
      label: '原始响应输出字段',
      default: DEFAULT_OCR_RAW_FIELD,
    },
    setText: {
      type: 'boolean',
      label: '写入 pipelineData.text',
      default: true,
    },
    ignoreMissingImage: {
      type: 'boolean',
      label: '无图片时忽略',
      default: false,
    },
    failOnEmpty: {
      type: 'boolean',
      label: '识别为空视为失败',
      default: true,
    },

    // Shared/optional OCR parameters
    languageType: {
      type: 'string',
      label: '语言参数(服务商自定义)',
      default: '',
      placeholder: '如 CHN_ENG 或 zh',
    },

    // Baidu OCR credentials
    baiduApiKey: {
      type: 'string',
      label: '百度 API Key',
      default: '',
    },
    baiduSecretKey: {
      type: 'string',
      label: '百度 Secret Key',
      default: '',
    },
    baiduAccessToken: {
      type: 'string',
      label: '百度 Access Token(可选)',
      default: '',
    },
    baiduProxyUrl: {
      type: 'string',
      label: '百度 Proxy 地址(可选)',
      default: '',
      placeholder: '/api/ocr/baidu 或 https://your-proxy/ocr/baidu',
    },
    baiduDetectDirection: {
      type: 'boolean',
      label: '百度-检测图像方向',
      default: false,
    },
    baiduDetectLanguage: {
      type: 'boolean',
      label: '百度-检测语言',
      default: false,
    },
    baiduParagraph: {
      type: 'boolean',
      label: '百度-返回段落信息',
      default: false,
    },
    baiduProbability: {
      type: 'boolean',
      label: '百度-返回置信度',
      default: false,
    },

    // Tencent OCR credentials
    tencentSecretId: {
      type: 'string',
      label: '腾讯 SecretId',
      default: '',
    },
    tencentSecretKey: {
      type: 'string',
      label: '腾讯 SecretKey',
      default: '',
    },
    tencentRegion: {
      type: 'string',
      label: '腾讯 Region(可选)',
      default: '',
    },
    tencentIsPdf: {
      type: 'boolean',
      label: '腾讯-是否为 PDF',
      default: false,
    },
    tencentPdfPageNumber: {
      type: 'number',
      label: '腾讯-PDF 页码',
      default: 1,
    },
    tencentIsWords: {
      type: 'boolean',
      label: '腾讯-输出单字信息',
      default: false,
    },
  },

  async execute({ message, config, pipelineData }) {
    const provider = (config?.provider || 'baidu') as OcrProvider;
    const outputField = config?.outputField || DEFAULT_OCR_OUTPUT_FIELD;
    const linesField = config?.linesField || DEFAULT_OCR_LINES_FIELD;
    const rawField = config?.rawField || DEFAULT_OCR_RAW_FIELD;
    const setText = toBoolean(config?.setText, true);
    const ignoreMissingImage = toBoolean(config?.ignoreMissingImage, false);
    const failOnEmpty = toBoolean(config?.failOnEmpty, true);
    const languageType = typeof config?.languageType === 'string' ? config.languageType : undefined;

    try {
      logOcr('Start OCR', { messageId: message.id, chatId: message.chatId, provider });
      const base64 = await getImageBase64FromMessage(message);
      if (!base64) {
        logOcr('No image found for OCR', { messageId: message.id, chatId: message.chatId });
        return {
          success: !ignoreMissingImage ? false : true,
          error: ignoreMissingImage ? undefined : 'No image found for OCR',
        };
      }

      if (provider === 'baidu') {
        const proxyUrlRaw = config?.baiduProxyUrl;
        const proxyUrl = typeof proxyUrlRaw === 'string' && proxyUrlRaw.trim()
          ? proxyUrlRaw.trim()
          : DEFAULT_BAIDU_PROXY_PATH;

        logOcr('Baidu OCR request start', { messageId: message.id, languageType, proxyUrl });
        const apiKey = config?.baiduApiKey as string | undefined;
        const secretKey = config?.baiduSecretKey as string | undefined;
        const accessTokenOverride = config?.baiduAccessToken as string | undefined;
        const detectDirection = toBoolean(config?.baiduDetectDirection, false);
        const detectLanguage = toBoolean(config?.baiduDetectLanguage, false);
        const paragraph = toBoolean(config?.baiduParagraph, false);
        const probability = toBoolean(config?.baiduProbability, false);

        const payload: Record<string, any> = {
          image: base64,
        };

        if (languageType) payload.languageType = languageType;
        if (detectDirection) payload.detectDirection = true;
        if (detectLanguage) payload.detectLanguage = true;
        if (paragraph) payload.paragraph = true;
        if (probability) payload.probability = true;
        if (accessTokenOverride) payload.accessToken = accessTokenOverride;
        if (apiKey) payload.apiKey = apiKey;
        if (secretKey) payload.secretKey = secretKey;

        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          logOcr('Baidu OCR request failed', { status: response.status });
          return { success: false, error: `Baidu OCR request failed: ${response.status}` };
        }

        const data = await response.json() as {
          words_result?: Array<{ words: string }>;
          words_result_num?: number;
          error_code?: number;
          error_msg?: string;
        };

        if (data.error_code) {
          logOcr('Baidu OCR error', { errorCode: data.error_code, errorMsg: data.error_msg });
          return { success: false, error: `Baidu OCR error ${data.error_code}: ${data.error_msg || ''}` };
        }

        const lines = (data.words_result || []).map((item) => item.words).filter(Boolean);
        const text = lines.join('\n');
        const isEmpty = !text;

        if (setText) {
          pipelineData.text = text;
        }

        logOcr('Baidu OCR success', { lines: lines.length, textLength: text.length });
        return {
          success: failOnEmpty ? !isEmpty : true,
          data: {
            [outputField]: text,
            [linesField]: lines,
            [rawField]: data,
            ocrProvider: 'baidu',
          },
        };
      }

      if (provider === 'tencent') {
        logOcr('Tencent OCR request start', { messageId: message.id, languageType });
        const secretId = config?.tencentSecretId as string | undefined;
        const secretKey = config?.tencentSecretKey as string | undefined;
        const region = typeof config?.tencentRegion === 'string' ? config.tencentRegion : undefined;
        const isPdf = toBoolean(config?.tencentIsPdf, false);
        const pdfPageNumber = toNumber(config?.tencentPdfPageNumber);
        const isWords = toBoolean(config?.tencentIsWords, false);

        if (!secretId || !secretKey) {
          logOcr('Tencent OCR missing credentials');
          return { success: false, error: 'Tencent OCR requires secretId and secretKey' };
        }

        const payload: Record<string, any> = {
          ImageBase64: base64,
        };

        if (languageType) payload.LanguageType = languageType;
        if (isPdf) payload.IsPdf = true;
        if (pdfPageNumber !== undefined) payload.PdfPageNumber = pdfPageNumber;
        if (isWords) payload.IsWords = true;

        const payloadJson = JSON.stringify(payload);
        const timestamp = Math.floor(Date.now() / 1000);
        const host = 'ocr.tencentcloudapi.com';
        const service = 'ocr';
        const authorization = await signTencentRequest(
          secretId,
          secretKey,
          timestamp,
          payloadJson,
          host,
          service,
        );

        const headers: Record<string, string> = {
          Authorization: authorization,
          'Content-Type': 'application/json; charset=utf-8',
          'X-TC-Action': 'GeneralBasicOCR',
          'X-TC-Version': '2018-11-19',
          'X-TC-Timestamp': String(timestamp),
        };

        if (region) {
          headers['X-TC-Region'] = region;
        }

        const response = await fetch(`https://${host}/`, {
          method: 'POST',
          headers,
          body: payloadJson,
        });

        if (!response.ok) {
          logOcr('Tencent OCR request failed', { status: response.status });
          return { success: false, error: `Tencent OCR request failed: ${response.status}` };
        }

        const data = await response.json() as {
          Response?: {
            TextDetections?: Array<{ DetectedText: string }>;
            Error?: { Code?: string; Message?: string };
          };
        };

        if (data.Response?.Error?.Code) {
          logOcr('Tencent OCR error', {
            errorCode: data.Response.Error.Code,
            errorMsg: data.Response.Error.Message,
          });
          return {
            success: false,
            error: `Tencent OCR error ${data.Response.Error.Code}: ${data.Response.Error.Message || ''}`,
          };
        }

        const lines = (data.Response?.TextDetections || [])
          .map((item) => item.DetectedText)
          .filter(Boolean);
        const text = lines.join('\n');
        const isEmpty = !text;

        if (setText) {
          pipelineData.text = text;
        }

        logOcr('Tencent OCR success', { lines: lines.length, textLength: text.length });
        return {
          success: failOnEmpty ? !isEmpty : true,
          data: {
            [outputField]: text,
            [linesField]: lines,
            [rawField]: data,
            ocrProvider: 'tencent',
          },
        };
      }

      logOcr('Unsupported OCR provider', { provider });
      return { success: false, error: `Unsupported OCR provider: ${provider}` };
    } catch (error) {
      logOcr('OCR exception', { error: error instanceof Error ? error.message : String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
