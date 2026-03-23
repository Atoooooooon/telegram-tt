# 规则引擎 API 参考文档

> **版本**: v1.0
> **最后更新**: 2025-12-08

---

## 目录

- [1. 核心 API](#1-核心-api)
- [2. 能力开发指南](#2-能力开发指南)
- [3. 内置能力参考](#3-内置能力参考)
- [4. 配置示例](#4-配置示例)
- [5. 工具函数](#5-工具函数)

---

## 1. 核心 API

### 1.1 registerCapability

**功能**: 注册一个新能力到引擎

**签名**:
```typescript
function registerCapability(capability: Capability): void
```

**参数**:
- `capability`: 能力定义对象

**示例**:
```typescript
import { registerCapability } from '../helpers/ruleEngine';

registerCapability({
  id: 'my_custom_checker',
  name: '自定义检测器',
  type: 'checker',
  configSchema: {
    threshold: {
      type: 'number',
      label: '阈值',
      default: 10,
    },
  },
  async execute({ message, config }) {
    // 实现检测逻辑
    return {
      success: true,
      data: { result: 'checked' },
    };
  },
});
```

---

### 1.2 executeRule

**功能**: 执行单条规则

**签名**:
```typescript
async function executeRule(
  rule: UserRule,
  message: ApiMessage,
  global: GlobalState,
  actions: any
): Promise<void>
```

**参数**:
- `rule`: 规则配置对象
- `message`: 待处理的消息
- `global`: 全局状态
- `actions`: Actions 对象(用于调用 action handlers)

**返回**: Promise<void>

**异常**: 内部异常会被捕获并记录到控制台,不会抛出

**示例**:
```typescript
import { executeRule } from '../helpers/ruleEngine';

const rule: UserRule = {
  id: 'test_rule',
  name: '测试规则',
  enabled: true,
  trigger: {
    eventType: 'customer_message',
  },
  pipeline: [
    {
      id: 'step1',
      capabilityId: 'check_text_match',
      config: { pattern: 'hello', mode: '包含' },
    },
  ],
};

await executeRule(rule, message, global, actions);
```

---

### 1.3 processMessageWithRules

**功能**: 使用所有已启用规则处理消息(引擎主入口)

**签名**:
```typescript
async function processMessageWithRules(
  message: ApiMessage,
  eventType: 'customer_message' | 'bot_reply',
  global: GlobalState,
  actions: any
): Promise<boolean>
```

**参数**:
- `message`: 待处理的消息
- `eventType`: 消息类型
- `global`: 全局状态
- `actions`: Actions 对象

**返回**:
- `true`: 有规则匹配并执行
- `false`: 无规则匹配

**示例**:
```typescript
// 在 messages.ts 中调用
const handled = await processMessageWithRules(
  message,
  'customer_message',
  global,
  actions
);

if (!handled) {
  // 降级到旧逻辑
  const isFiltered = shouldFilterMessage(...);
  if (!isFiltered) {
    actions.addToCustomerServiceV2({ message, chatId });
  }
}
```

---

## 2. 能力开发指南

### 2.1 能力接口

```typescript
export type Capability = {
  // 唯一标识符(建议格式: <type>_<name>)
  id: string;

  // 显示名称
  name: string;

  // 能力类型
  type: 'checker' | 'extractor' | 'action';

  // 描述(可选,用于UI提示)
  description?: string;

  // 配置参数定义
  configSchema: CapabilityConfigSchema;

  // 执行函数
  execute: (input: CapabilityInput) => Promise<CapabilityOutput>;
};
```

### 2.2 执行函数参数

```typescript
type CapabilityInput = {
  // 当前处理的消息
  message: ApiMessage;

  // 用户配置的参数(根据 configSchema 定义)
  config: Record<string, any>;

  // 全局状态(只读)
  global: GlobalState;

  // Actions 对象(仅 action 类型能力使用)
  actions: any;

  // 管道累积数据(前面步骤的输出)
  pipelineData: Record<string, any>;
};
```

### 2.3 执行函数返回值

```typescript
type CapabilityOutput = {
  // 是否成功
  success: boolean;

  // 输出数据(可选,会合并到 pipelineData)
  data?: Record<string, any>;

  // 错误信息(可选,仅在 success=false 时提供)
  error?: string;
};
```

### 2.4 开发步骤

#### Step 1: 定义能力结构

```typescript
// src/global/helpers/capabilities/myCapability.ts

import type { Capability } from '../../types/customerServiceV2';

export const myCustomCapability: Capability = {
  id: 'my_custom_action',
  name: '我的自定义动作',
  type: 'action',
  description: '执行自定义业务逻辑',

  configSchema: {
    // 定义配置参数
    param1: {
      type: 'string',
      label: '参数1',
      required: true,
    },
    param2: {
      type: 'number',
      label: '参数2',
      default: 10,
    },
  },

  async execute(input) {
    // 实现逻辑
  },
};
```

#### Step 2: 实现 execute 函数

```typescript
async execute({ message, config, global, actions, pipelineData }) {
  try {
    // 1. 获取配置参数
    const { param1, param2 } = config;

    // 2. 访问管道数据
    const previousResult = pipelineData.someKey;

    // 3. 执行业务逻辑
    const result = await doSomething(param1, param2);

    // 4. 返回结果
    return {
      success: true,
      data: {
        myOutput: result,
      },
    };
  } catch (error) {
    // 错误处理
    return {
      success: false,
      error: error.message,
    };
  }
}
```

#### Step 3: 注册能力

```typescript
// src/global/helpers/capabilities/index.ts

import { registerCapability } from '../ruleEngine';
import { myCustomCapability } from './myCapability';

// 在模块加载时自动注册
registerCapability(myCustomCapability);

// 导出供其他模块使用
export { myCustomCapability };
```

### 2.5 最佳实践

#### ✅ DO

1. **参数校验**: 在 execute 开始检查必填参数
```typescript
async execute({ config }) {
  if (!config.requiredParam) {
    return {
      success: false,
      error: 'Missing required parameter: requiredParam',
    };
  }
  // ...
}
```

2. **错误处理**: 使用 try-catch 捕获异常
```typescript
async execute(input) {
  try {
    // 业务逻辑
  } catch (error) {
    console.error(`[${this.id}] Execution failed:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
}
```

3. **超时控制**: 异步操作添加超时
```typescript
async execute({ config }) {
  const timeout = config.timeout || 5000;
  const result = await Promise.race([
    fetchData(config.url),
    sleep(timeout).then(() => Promise.reject(new Error('Timeout'))),
  ]);
  // ...
}
```

4. **数据验证**: 输出数据前验证格式
```typescript
return {
  success: true,
  data: {
    // 确保所有值可序列化(不能包含函数、循环引用等)
    orderId: String(orderId),
    status: result.status || 'unknown',
  },
};
```

#### ❌ DON'T

1. **不要修改输入参数**
```typescript
// ❌ 错误
async execute({ message, pipelineData }) {
  message.text = 'modified';  // 永远不要这样做!
  pipelineData.foo = 'bar';   // 也不要这样!
}

// ✅ 正确
async execute({ message, pipelineData }) {
  return {
    success: true,
    data: {
      modifiedText: message.text + ' [modified]',
      foo: 'bar',
    },
  };
}
```

2. **不要阻塞主线程**
```typescript
// ❌ 错误
async execute() {
  while (true) {
    // 无限循环会卡死
  }
}

// ✅ 正确
async execute({ config }) {
  const maxIterations = config.maxIterations || 100;
  for (let i = 0; i < maxIterations; i++) {
    // 有界循环
  }
}
```

3. **不要泄露敏感信息**
```typescript
// ❌ 错误
return {
  success: true,
  data: {
    apiKey: process.env.API_KEY,  // 不要输出密钥!
  },
};

// ✅ 正确
return {
  success: true,
  data: {
    result: 'API called successfully',
  },
};
```

---

## 3. 内置能力参考

### 3.1 检测类能力

#### check_text_match

**功能**: 检查消息文本是否匹配条件

**配置参数**:
```typescript
{
  pattern: string;           // 匹配模式
  mode: '包含' | '正则' | '完全相等';  // 匹配方式
}
```

**输出数据**:
```typescript
{
  matched: boolean;         // 是否匹配
  matchedText?: string;     // 匹配的文本(仅当matched=true)
}
```

**示例**:
```json
{
  "capabilityId": "check_text_match",
  "config": {
    "pattern": "订单|查单|单号",
    "mode": "正则"
  }
}
```

---

#### check_has_reply

**功能**: 检查消息是否已被回复

**配置参数**:
```typescript
{
  timeWindow: number;  // 时间窗口(秒),默认300
}
```

**输出数据**:
```typescript
{
  hasReply: boolean;      // 是否有回复
  replyCount: number;     // 回复数量
  lastReplyTime?: number; // 最后回复时间戳
}
```

**示例**:
```json
{
  "capabilityId": "check_has_reply",
  "config": {
    "timeWindow": 600
  }
}
```

---

#### check_user_level

**功能**: 检查用户等级

**配置参数**:
```typescript
{
  minLevel: number;       // 最低等级
  operator: '>=' | '>' | '==' | '<' | '<=';  // 比较运算符
}
```

**输出数据**:
```typescript
{
  userLevel: number;      // 用户当前等级
  passed: boolean;        // 是否通过检查
}
```

**示例**:
```json
{
  "capabilityId": "check_user_level",
  "config": {
    "minLevel": 3,
    "operator": ">="
  }
}
```

---

#### check_has_media

**功能**: 检查消息是否包含媒体

**配置参数**:
```typescript
{
  mediaType: 'photo' | 'video' | 'document' | 'any';
}
```

**输出数据**:
```typescript
{
  hasMedia: boolean;
  mediaType?: string;     // 实际媒体类型
  mediaUrl?: string;      // 媒体URL(如果可获取)
}
```

---

#### check_is_forwarded

**功能**: 检查消息是否为转发

**配置参数**: 无

**输出数据**:
```typescript
{
  isForwarded: boolean;
  forwardFrom?: string;   // 转发来源
}
```

---

### 3.2 提取类能力

#### extract_ocr

**功能**: 从图片中识别文字

**配置参数**:
```typescript
{
  language: string;       // 识别语言(如 'chi_sim+eng')
  extractPattern?: string; // 提取正则(可选)
}
```

**输出数据**:
```typescript
{
  fullText: string;       // 完整识别文本
  extracted?: string;     // 提取的内容(如果指定了extractPattern)
}
```

**示例**:
```json
{
  "capabilityId": "extract_ocr",
  "config": {
    "language": "chi_sim+eng",
    "extractPattern": "[A-Z]{2}\\d{10,15}"
  }
}
```

**注意事项**:
- 需要配置 OCR 服务(如 Tesseract)
- 识别耗时较长(2-5秒),建议设置超时

---

#### extract_regex

**功能**: 从文本中提取匹配内容

**配置参数**:
```typescript
{
  pattern: string;        // 正则表达式
  group?: number;         // 捕获组索引(默认0)
}
```

**输出数据**:
```typescript
{
  matched: boolean;
  extracted?: string;     // 提取的内容
  allMatches?: string[];  // 所有匹配项
}
```

**示例**:
```json
{
  "capabilityId": "extract_regex",
  "config": {
    "pattern": "订单号[::]\\s*([A-Z0-9]+)",
    "group": 1
  }
}
```

---

#### call_api

**功能**: 调用外部 HTTP API

**配置参数**:
```typescript
{
  url: string;            // API 地址
  method: 'GET' | 'POST'; // 请求方法
  bodyTemplate?: string;  // 请求体模板(支持 {{变量}})
  headers?: Record<string, string>; // 自定义请求头
  timeout?: number;       // 超时时间(ms),默认5000
}
```

**输出数据**:
```typescript
{
  apiResponse: any;       // API 返回的数据
  statusCode: number;     // HTTP 状态码
}
```

**示例**:
```json
{
  "capabilityId": "call_api",
  "config": {
    "url": "https://api.example.com/order/query",
    "method": "POST",
    "bodyTemplate": "{\"orderId\": \"{{extracted}}\"}",
    "headers": {
      "Authorization": "Bearer {{apiToken}}"
    },
    "timeout": 10000
  }
}
```

**模板变量**:
- 支持 `{{pipelineData中的任意字段}}`
- 嵌套字段用点号: `{{apiResponse.data.status}}`

---

### 3.3 动作类能力

#### action_mark_read

**功能**: 从客服队列移除消息(标记为已读)

**配置参数**:
```typescript
{
  targetMessage: '当前消息' | '回复的原消息';
}
```

**输出数据**:
```typescript
{
  markedMessageId: number; // 被标记的消息ID
}
```

**示例**:
```json
{
  "capabilityId": "action_mark_read",
  "config": {
    "targetMessage": "回复的原消息"
  }
}
```

---

#### action_auto_reply

**功能**: 发送自动回复

**配置参数**:
```typescript
{
  template: string;       // 回复模板(支持 {{变量}})
  replyToOriginal?: boolean; // 是否回复原消息(默认true)
}
```

**输出数据**:
```typescript
{
  repliedText: string;    // 实际发送的文本
  sentMessageId: number;  // 发送的消息ID
}
```

**示例**:
```json
{
  "capabilityId": "action_auto_reply",
  "config": {
    "template": "您的订单 {{extracted}} 状态: {{apiResponse.status}}",
    "replyToOriginal": true
  }
}
```

---

#### action_add_queue

**功能**: 添加消息到客服队列

**配置参数**: 无

**输出数据**:
```typescript
{
  addedToQueue: boolean;
}
```

---

#### action_forward

**功能**: 转发消息到指定聊天窗口

**配置参数**:
```typescript
{
  toChatId: string;       // 目标聊天ID(必填)
  dropAuthor?: boolean;   // 隐藏原作者(默认false)
  dropCaption?: boolean;  // 删除原标题(默认false)
}
```

**输出数据**:
```typescript
{
  forwardedTo: string;    // 目标聊天ID
  messageId: number;      // 原消息ID
}
```

**示例**:
```json
{
  "capabilityId": "action_forward",
  "config": {
    "toChatId": "-1001234567890",
    "dropAuthor": false,
    "dropCaption": false
  }
}
```

**使用场景**:
- 将客户投诉转发到管理群
- 将重要消息转发给特定负责人
- 建立消息备份机制

---

#### action_send_to

**功能**: 发送新消息到指定聊天窗口

**配置参数**:
```typescript
{
  toChatId: string;       // 目标聊天ID(必填)
  template: string;       // 消息模板(必填,支持 {{变量}})
}
```

**输出数据**:
```typescript
{
  sentTo: string;         // 目标聊天ID
  sentText: string;       // 实际发送的文本
  sentMessageId: number;  // 发送的消息ID (重要：用于后续等待回复)
}
```

**示例**:
```json
{
  "capabilityId": "action_send_to",
  "config": {
    "toChatId": "987654321",
    "template": "⚠️ 检测到异常消息\n用户: {{sender}}\n内容: {{text}}"
  }
}
```

**使用场景**:
- 向管理员发送告警通知
- 跨群组同步消息摘要
- 触发工作流通知

**注意事项**:
- 与 `action_auto_reply` 的区别:
  - `action_auto_reply`: 在当前聊天窗口回复消息
  - `action_send_to`: 向另一个聊天窗口发送新消息
- 与 `action_forward` 的区别:
  - `action_forward`: 转发现有消息(保留原消息结构)
  - `action_send_to`: 发送自定义格式的新消息(使用模板)
  
  ---
  
  #### wait_for_reply
  
  **功能**: 在指定聊天中等待特定消息的回复(非阻塞轮询)
  
  **配置参数**:
  ```typescript
  {
    chatId?: string;        // 目标聊天ID(默认当前聊天)
    messageIdField: string; // 消息ID来源字段(默认 'sentMessageId')
    timeout: number;        // 超时秒数(默认 60)
    pollInterval: number;   // 轮询间隔秒数(默认 5)
  }
  ```
  
  **输出数据**:
  ```typescript
  {
    botReplyText: string;      // 捕获到的回复文本
    botReplyMessageId: number; // 回复消息的ID
  }
  ```
  
  **示例**:
  ```json
  {
    "capabilityId": "wait_for_reply",
    "config": {
      "messageIdField": "sentMessageId",
      "timeout": 30
    }
  }
  ```
  
  ---
  
  #### action_notify
**功能**: 向客服人员发送通知

**配置参数**:
```typescript
{
  message: string;        // 通知内容模板
  notifyChannel?: string; // 通知渠道(可选,用于未来扩展)
}
```

**输出数据**:
```typescript
{
  notified: boolean;
}
```

---

## 4. 配置示例

### 4.1 完整规则示例

```typescript
const exampleRule: UserRule = {
  id: 'rule_001',
  name: 'VIP用户OCR自动查单',
  enabled: true,
  priority: 10,

  trigger: {
    eventType: 'customer_message',
    chatIds: ['-1001234567890'],
  },

  pipeline: [
    // 步骤1: 检查用户等级
    {
      id: 'step1',
      capabilityId: 'check_user_level',
      config: {
        minLevel: 3,
        operator: '>=',
      },
      onFailure: {
        stopPipeline: true,
      },
    },

    // 步骤2: 检查是否有图片
    {
      id: 'step2',
      capabilityId: 'check_has_media',
      config: {
        mediaType: 'photo',
      },
      onFailure: {
        stopPipeline: true,
      },
    },

    // 步骤3: OCR识别
    {
      id: 'step3',
      capabilityId: 'extract_ocr',
      config: {
        language: 'chi_sim+eng',
        extractPattern: '[A-Z]{2}\\d{10,15}',
      },
      onFailure: {
        executeAction: 'action_auto_reply',
        stopPipeline: true,
      },
    },

    // 步骤4: 调用API
    {
      id: 'step4',
      capabilityId: 'call_api',
      config: {
        url: 'https://api.internal.com/order/query',
        method: 'POST',
        bodyTemplate: '{"orderId": "{{extracted}}"}',
        timeout: 10000,
      },
    },

    // 步骤5: 自动回复
    {
      id: 'step5',
      capabilityId: 'action_auto_reply',
      config: {
        template: `[VIP专属查询]
订单号: {{extracted}}
状态: {{apiResponse.status}}
物流: {{apiResponse.tracking}}
预计送达: {{apiResponse.eta}}`,
      },
    },
  ],
};
```

### 4.2 条件路由示例

```typescript
{
  pipeline: [
    {
      id: 'check_keyword',
      capabilityId: 'check_text_match',
      config: {
        pattern: '紧急|urgent',
        mode: '正则',
      },
      onSuccess: {
        gotoStep: 'high_priority_handler',  // 跳转到高优先级处理
      },
      onFailure: {
        continueNext: true,  // 继续正常流程
      },
    },
    {
      id: 'normal_handler',
      capabilityId: 'action_add_queue',
      config: {},
    },
    {
      id: 'high_priority_handler',
      capabilityId: 'action_notify',
      config: {
        message: '紧急消息: {{text}}',
      },
    },
  ],
}
```

---

## 5. 工具函数

### 5.1 renderTemplate

**功能**: 渲染模板字符串,替换 `{{变量}}`

**签名**:
```typescript
function renderTemplate(
  template: string,
  data: Record<string, any>
): string
```

**示例**:
```typescript
import { renderTemplate } from '../helpers/templateRenderer';

const result = renderTemplate(
  '订单{{orderId}}状态: {{status}}',
  { orderId: 'ABC123', status: '已发货' }
);
// 输出: "订单ABC123状态: 已发货"
```

**高级用法**:
```typescript
// 嵌套字段
renderTemplate(
  '用户{{user.name}}等级{{user.level}}',
  { user: { name: 'Alice', level: 5 } }
);
// 输出: "用户Alice等级5"
```

---

### 5.2 extractImageUrl

**功能**: 从消息中提取图片URL

**签名**:
```typescript
function extractImageUrl(message: ApiMessage): string | undefined
```

**示例**:
```typescript
import { extractImageUrl } from '../helpers/messageUtils';

const imageUrl = extractImageUrl(message);
if (imageUrl) {
  // 处理图片
}
```

---

### 5.3 getMessageText

**功能**: 获取消息文本内容

**签名**:
```typescript
function getMessageText(message: ApiMessage): ApiFormattedText | undefined
```

**示例**:
```typescript
import { getMessageText } from '../helpers/messages';

const text = getMessageText(message)?.text || '';
```

---

## 附录

### A. 类型定义完整参考

```typescript
// 完整类型定义见:
// src/global/types/customerServiceV2.ts
```

### B. 错误码

| 错误码 | 含义 | 处理建议 |
|-------|------|---------|
| `CAPABILITY_NOT_FOUND` | 能力未注册 | 检查 capabilityId 是否正确 |
| `INVALID_CONFIG` | 配置参数无效 | 检查配置是否符合 configSchema |
| `EXECUTION_TIMEOUT` | 执行超时 | 增加 timeout 参数或优化能力逻辑 |
| `PIPELINE_FAILED` | 管道执行失败 | 查看控制台日志定位具体步骤 |

---

**文档结束**
