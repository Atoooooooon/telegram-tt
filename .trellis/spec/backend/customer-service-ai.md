# Customer Service AI Contracts

> Cross-layer contracts for the customer-service AI proxy, scenario knowledge, and success-case training material.

## Scenario: Success Case Training Material

### 1. Scope / Trigger

Use this contract when saving or reading customer-service success cases through:

```text
POST /api/customer-service/success-case
GET /api/customer-service/success-cases?limit=<number>
DELETE /api/customer-service/success-case?id=<id>
```

This is a cross-layer API contract because the renderer creates the payload, the Node API proxy normalizes it, Redis stores it, and the renderer reads it back for review.

### 2. Signatures

Renderer helper:

```ts
type CustomerServiceSuccessCaseImageReference = {
  chatId?: string;
  messageId?: number;
  description?: string;
  source?: 'vision_model' | 'operator' | 'message_context';
};

type CustomerServiceSuccessCasePayload = {
  recordType: 'ai_draft_sent' | 'ai_action_approved' | 'case_resolved';
  caseId?: string;
  chatId: string;
  senderId?: string;
  messageIds?: number[];
  sourceText?: string;
  aiSummary?: string;
  aiIntent?: string;
  aiDraft?: string;
  finalReply?: string;
  wasEdited?: boolean;
  imageSummary?: string;
  imageReferences?: CustomerServiceSuccessCaseImageReference[];
  metadata?: Record<string, unknown>;
};
```

Redis storage key:

```text
telegram_web:customer-service:success-cases
```

### 3. Contracts

The server stores each success case as one JSON string in a Redis list. The stored record keeps structured fields and adds generated readable material:

```ts
type CustomerServiceSuccessCaseRecord = CustomerServiceSuccessCasePayload & {
  id: string;
  createdAt: number;
  markdown?: string;
};
```

`imageSummary` is a short text description of the image content, ideally from the vision-capable model. `imageReferences` stores only source references and descriptions. It must never store image binary data, base64 strings, object URLs, or downloaded file contents.

### 4. Validation & Error Matrix

| Input / Condition | Server Behavior |
| --- | --- |
| Missing or invalid `recordType` | HTTP 400 with `recordType must be one of: ai_draft_sent, ai_action_approved, case_resolved` |
| Missing `chatId` | HTTP 400 with `chatId is required` |
| Redis not configured | HTTP 503 with `Redis is not configured` |
| More than 8 image references | Keep the first 8 references |
| Empty image reference object | Drop the entry |
| Unsupported image reference `source` | Store the reference without `source` |
| Old Redis record without `markdown` | Keep compatibility; renderer uses structured fallback sections |

### 5. Good / Base / Bad Cases

Good case:

```json
{
  "recordType": "case_resolved",
  "chatId": "-1001",
  "messageIds": [101, 102],
  "sourceText": "客户发送付款截图和单号 ORD123456789",
  "aiSummary": "客户查询代收订单是否到账",
  "aiIntent": "支付订单查询",
  "finalReply": "您好，订单已核对成功。",
  "imageSummary": "截图显示 DANA 付款成功凭证，金额 10000，含订单流水号。",
  "imageReferences": [
    {
      "chatId": "-1001",
      "messageId": 102,
      "description": "DANA 付款成功截图",
      "source": "vision_model"
    }
  ]
}
```

Base case:

```json
{
  "recordType": "case_resolved",
  "chatId": "-1001",
  "sourceText": "客户只发文字查单",
  "aiIntent": "支付订单查询"
}
```

Bad case:

```json
{
  "recordType": "case_resolved",
  "chatId": "-1001",
  "imageReferences": [
    {
      "description": "data:image/jpeg;base64,..."
    }
  ]
}
```

Do not store base64 image data in success cases. Store a concise description instead.

### 6. Tests Required

Project-level instructions currently disallow adding new tests. Required verification for this contract:

```bash
node --check server/lib/customer-service-success-cases.mjs
npx tsc --noEmit --pretty false
```

Manual assertion points:

1. New saved records include `markdown`.
2. `markdown` includes `Image Summary` when `imageSummary` is provided.
3. `imageReferences` keeps chat/message IDs and descriptions only.
4. Old records without `markdown` still render through structured fallback UI.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "imageReferences": [
    {
      "messageId": 102,
      "base64": "/9j/4AAQSkZJRgABA..."
    }
  ]
}
```

#### Correct

```json
{
  "imageSummary": "截图显示 DANA 付款成功凭证，金额 10000。",
  "imageReferences": [
    {
      "chatId": "-1001",
      "messageId": 102,
      "description": "DANA 付款成功截图",
      "source": "vision_model"
    }
  ]
}
```

## Scenario: Scenario Knowledge Redis Seeding

### 1. Scope / Trigger

Use this contract when reading or writing customer-service scenario markdown:

```text
GET /api/customer-service/scenario-knowledge
POST /api/customer-service/scenario-knowledge
```

### 2. Contracts

Redis storage key:

```text
telegram_web:customer-service:scenario-knowledge
```

Default source file:

```text
docs/customer-service-oncall-scenarios.md
```

When Redis is configured and the key is missing, the server reads the default source file and writes it to Redis. A successful seed response uses:

```json
{
  "ok": true,
  "record": {
    "format": "markdown",
    "content": "...",
    "updatedAt": 1780920000000
  },
  "source": "redis-seeded",
  "unavailable": false
}
```

If Redis is unavailable, the server returns fallback markdown without seeding and sets `unavailable: true`.

### 3. Wrong vs Correct

#### Wrong

Only returning the fallback file forever leaves no Redis key for operators to edit.

#### Correct

Seed the fallback markdown into Redis on the first Redis miss, then subsequent reads return `source: redis`.
