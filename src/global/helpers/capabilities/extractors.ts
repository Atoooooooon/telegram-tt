/**
 * Text processor capability
 * Extract, clean, transform, and validate text content
 */

import type { Capability } from '../../types/customerServiceV2';

export const textProcessorCapability: Capability = {
  id: 'text_processor',
  name: '文本处理器',
  type: 'extractor',
  description: '提取、清洗、转换、验证文本内容',

  configSchema: {
    // Input/Output
    inputField: {
      type: 'string',
      label: '输入字段',
      default: 'text',
      placeholder: 'pipelineData 中的字段名',
    },
    outputField: {
      type: 'string',
      label: '输出字段',
      default: 'extractedText',
      placeholder: '结果写入的字段名',
    },

    // Clean operations
    cleanEnabled: {
      type: 'boolean',
      label: '启用清洗',
      default: false,
    },
    cleanPrefixes: {
      type: 'string',
      label: '移除前缀',
      default: '/ds,/df,/d,/订单,/单号',
      placeholder: '用逗号分隔',
    },
    cleanTrim: {
      type: 'boolean',
      label: '去除首尾空格',
      default: true,
    },
    cleanRemoveSpecial: {
      type: 'boolean',
      label: '移除特殊字符',
      default: false,
    },
    cleanRemoveWhitespace: {
      type: 'boolean',
      label: '移除所有空格',
      default: false,
    },

    // Extract operations
    extractEnabled: {
      type: 'boolean',
      label: '启用提取',
      default: false,
    },
    extractPattern: {
      type: 'string',
      label: '提取正则',
      default: '',
      placeholder: '([0-9]{8,})',
    },
    extractFlags: {
      type: 'string',
      label: '正则 flags',
      default: '',
      placeholder: 'g, i, m',
    },
    extractGroupIndex: {
      type: 'number',
      label: '捕获组索引',
      default: 0,
    },
    extractFallback: {
      type: 'string',
      label: '未匹配默认值',
      default: '',
    },

    // Transform operations
    transformEnabled: {
      type: 'boolean',
      label: '启用转换',
      default: false,
    },
    transformCase: {
      type: 'select',
      label: '大小写',
      options: ['none', 'upper', 'lower', 'capitalize'],
      default: 'none',
    },
    transformReplaceFrom: {
      type: 'string',
      label: '替换内容',
      default: '',
      placeholder: '要替换的字符串',
    },
    transformReplaceTo: {
      type: 'string',
      label: '替换为',
      default: '',
      placeholder: '替换后的字符串',
    },

    // Validate operations
    validateEnabled: {
      type: 'boolean',
      label: '启用验证',
      default: false,
    },
    validateMinLength: {
      type: 'number',
      label: '最小长度',
      default: 0,
    },
    validateMaxLength: {
      type: 'number',
      label: '最大长度',
      default: 0,
    },
    validateNumeric: {
      type: 'boolean',
      label: '仅数字',
      default: false,
    },
  },

  execute({ config, pipelineData }) {
    const {
      inputField = 'text',
      outputField = 'extractedText',

      // Clean
      cleanEnabled,
      cleanPrefixes,
      cleanTrim,
      cleanRemoveSpecial,
      cleanRemoveWhitespace,

      // Extract
      extractEnabled,
      extractPattern,
      extractFlags,
      extractGroupIndex,
      extractFallback,

      // Transform
      transformEnabled,
      transformCase,
      transformReplaceFrom,
      transformReplaceTo,

      // Validate
      validateEnabled,
      validateMinLength,
      validateMaxLength,
      validateNumeric,
    } = config;

    let value = pipelineData[inputField] || '';

    // Clean
    if (cleanEnabled) {
      if (cleanPrefixes) {
        const prefixes = cleanPrefixes.split(',').map((p: string) => p.trim()).filter(Boolean);
        for (const prefix of prefixes) {
          value = value.replace(new RegExp(`^${prefix}[\\s]*`, 'i'), '');
        }
      }
      if (cleanTrim) value = value.trim();
      if (cleanRemoveWhitespace) value = value.replace(/\s+/g, '');
      if (cleanRemoveSpecial) value = value.replace(/[^\w\s\u4e00-\u9fa5]/g, '');
    }

    // Extract
    if (extractEnabled && extractPattern) {
      try {
        const regex = new RegExp(extractPattern, extractFlags || '');
        const match = regex.exec(value);
        value = match
          ? (extractGroupIndex! > 0 ? match[extractGroupIndex!] ?? match[0] : match[0])
          : (extractFallback ?? '');
      } catch (error) {
        return Promise.resolve({ success: false, error: 'Invalid extract pattern' });
      }
    }

    // Transform
    if (transformEnabled) {
      if (transformCase === 'upper') {
        value = value.toUpperCase();
      } else if (transformCase === 'lower') {
        value = value.toLowerCase();
      } else if (transformCase === 'capitalize') {
        value = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
      }

      if (transformReplaceFrom !== undefined && transformReplaceTo !== undefined) {
        value = value.replaceAll(transformReplaceFrom, transformReplaceTo);
      }
    }

    // Validate
    if (validateEnabled) {
      const valid =
        (validateMinLength === undefined || validateMinLength === 0 || value.length >= validateMinLength) &&
        (validateMaxLength === undefined || validateMaxLength === 0 || value.length <= validateMaxLength) &&
        (!validateNumeric || /^\d+$/.test(value));

      if (!valid) {
        return Promise.resolve({
          success: false,
          data: {
            [outputField]: value,
            matchedText: value,
            validated: false,
          },
        });
      }
    }

    return Promise.resolve({
      success: true,
      data: {
        [outputField]: value,
        matchedText: value,
        extractedText: value,
        orderNumber: value,
        validated: validateEnabled,
      },
    });
  },
};
