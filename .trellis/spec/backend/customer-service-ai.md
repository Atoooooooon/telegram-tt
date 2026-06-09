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

## Scenario: Workbench Case Reply Context

### 1. Scope / Trigger

Use this contract when a customer-service case playbook, AI recommendation, follow-up automation, or success-case record needs context from a Telegram message that the current case message replies to.

Example: the customer sends a funds-flow video and replies to an older order message. The case must expose the older order message text so the playbook can extract the order number and the operator can understand the follow-up context.

### 2. Signatures

Renderer pipeline fields:

```ts
type CaseReplyMessageReference = {
  sourceChatId: string;
  sourceMessageId: number;
  replyToChatId: string;
  replyToMessageId: number;
  text: string;
};

type CaseReplyContext = {
  caseMessages: ApiMessage[];
  caseReplyMessages: ApiMessage[];
  caseContextMessages: ApiMessage[];
  caseReplyText: string;
  caseContextText: string;
  caseReplyMessageReferences: CaseReplyMessageReference[];
};
```

The rule engine initial `pipelineData` must include:

```ts
{
  caseText: string;
  caseReplyText: string;
  caseContextText: string;
  caseMessages: ApiMessage[];
  caseReplyMessages: ApiMessage[];
  caseContextMessages: ApiMessage[];
  caseReplyMessageReferences: CaseReplyMessageReference[];
}
```

### 3. Contracts

`caseText` remains the selected workbench case's grouped messages only.

`caseReplyText` is a readable summary of loaded reply-to source messages. It is best effort: only messages already available in the renderer global state are included.

`caseContextText` is `caseText` plus `caseReplyText`. Order extraction, AI playbook recommendation, and new follow-up automation should prefer this field over `caseText`.

`caseContextMessages` is a deduped array of `caseMessages` plus loaded `caseReplyMessages`. Media selection such as `case_first_media` and `case_last_media` should use `caseContextMessages` first, falling back to `caseMessages` for old contexts.

Success-case records should keep the normal `messageIds` as the selected case message ids and store reply references under `metadata.caseReplyMessageReferences`. Do not store image or video binary data.

### 4. Validation & Error Matrix

| Input / Condition | Behavior |
| --- | --- |
| Case message has no reply-to | `caseReplyText` is empty; `caseContextText` equals `caseText` |
| Reply-to source message is loaded | Add it to `caseReplyMessages`, `caseContextMessages`, and `caseReplyText` |
| Reply-to source message is not loaded | Omit it; do not fabricate text or block playbook execution |
| Multiple case messages reply to the same source | Deduplicate `caseReplyMessages` and `caseContextMessages`; keep structured reference rows |
| Referenced source has media | Media selectors can use it through `caseContextMessages`; stored success cases keep references only |

### 5. Good / Base / Bad Cases

Good case:

```json
{
  "caseText": "客户发送资金流水视频",
  "caseReplyText": "引用上下文:\n[引用消息 1] case消息 -1001:102 引用 -1001:88 订单号 Payout123456 金额 100000",
  "caseContextText": "客户发送资金流水视频\n引用上下文:\n[引用消息 1] case消息 -1001:102 引用 -1001:88 订单号 Payout123456 金额 100000",
  "caseReplyMessageReferences": [
    {
      "sourceChatId": "-1001",
      "sourceMessageId": 102,
      "replyToChatId": "-1001",
      "replyToMessageId": 88,
      "text": "订单号 Payout123456 金额 100000"
    }
  ]
}
```

Base case:

```json
{
  "caseText": "客户直接发送订单号 Payout123456",
  "caseReplyText": "",
  "caseContextText": "客户直接发送订单号 Payout123456"
}
```

Bad case:

```json
{
  "caseText": "客户发送资金流水视频",
  "caseReplyText": "",
  "orderNumber": ""
}
```

The bad case happens when the playbook keeps extracting from `caseText` even though the order number only exists in the replied-to source message.

### 6. Tests Required

Required verification for this contract:

```bash
npx tsc --noEmit --pretty false
npx eslint --cache --cache-location .cache/.eslintcache --rule react-hooks-static-deps/exhaustive-deps:off src/components/customerService/v2/middle/CustomerServiceMessageList.tsx src/global/helpers/capabilities/actions.ts src/global/helpers/customerServiceV2Settings.ts src/global/types/customerServiceV2.ts
git diff --check
```

Manual assertion points:

1. A case message replying to a loaded historical order message exposes that order in `caseContextText`.
2. The default VA and payout playbooks extract order numbers from `caseContextText`.
3. `case_first_media` / `case_last_media` can resolve media from `caseContextMessages`.
4. Saved success cases include `metadata.caseReplyMessageReferences` when reply-to context exists.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "capabilityId": "text_processor",
  "config": {
    "inputField": "caseText",
    "outputField": "orderNumber"
  }
}
```

#### Correct

```json
{
  "capabilityId": "text_processor",
  "config": {
    "inputField": "caseContextText",
    "outputField": "orderNumber"
  }
}
```

## Scenario: AI Auto-Run Case Playbooks

### 1. Scope / Trigger

Use this contract when a case playbook may be executed automatically after AI recommends it with high confidence. The first production use is auto-running the low-risk `/ds` pay-in lookup playbook after AI identifies a customer payment-order lookup from text/image context.

### 2. Signatures

Case playbook JSON:

```ts
type CustomerServiceCasePlaybook = UserRule & {
  kind?: 'case_playbook';
  exposable?: boolean;
  manualRunnable?: boolean;
  aiAutoRun?: {
    enabled?: boolean;
    minConfidence?: number; // 0-100, default 85
  };
};
```

Recommended JSON snippet:

```json
{
  "id": "case_va_order_feedback_demo",
  "exposable": true,
  "manualRunnable": true,
  "aiAutoRun": {
    "enabled": true,
    "minConfidence": 85
  }
}
```

### 3. Contracts

`exposable` controls AI visibility. If `exposable` is false, the playbook must not be sent to the AI playbook recommender and cannot be AI auto-run.

`manualRunnable` controls the workbench manual button. If `manualRunnable` is false, the playbook is hidden from the manual execution list, but it may still be AI-recommended or AI auto-run when `exposable` and `aiAutoRun.enabled` are true.

`aiAutoRun.enabled` permits automatic execution only after AI returns the same playbook id with `hasRunnablePlaybook=true`.

`aiAutoRun.minConfidence` is the minimum AI recommendation confidence. Missing or invalid values default to 85 and runtime clamps values into 0-100.

Auto-run must reuse the same `handleRunPlaybook` path as manual execution. Do not add a separate send-message path.

### 4. Validation & Error Matrix

| Input / Condition | Behavior |
| --- | --- |
| `aiAutoRun` missing | Never auto-run; show recommendation/manual controls only |
| `aiAutoRun.enabled=false` | Never auto-run |
| `exposable=false` | AI does not see the playbook; no AI recommendation or auto-run |
| `manualRunnable=false` and `exposable=true` | Hidden from manual list; still eligible for AI recommendation/auto-run |
| AI confidence below threshold | Do not auto-run |
| Missing `orderNumber` | Do not auto-run lookup playbook |
| Case already processing/resolved/replied | Do not auto-run |
| Same recommendation rendered multiple times | Run at most once per case/playbook/recommendation key |

### 5. Good / Base / Bad Cases

Good case:

```json
{
  "playbookId": "case_va_order_feedback_demo",
  "aiConfidence": 92,
  "orderNumber": "idn6603150418xap",
  "status": "待处理",
  "expected": "auto-run /ds playbook"
}
```

Base case:

```json
{
  "playbookId": "case_va_order_feedback_demo",
  "aiConfidence": 70,
  "expected": "show recommendation only"
}
```

Bad case:

```json
{
  "playbookId": "case_payout_no_funds_demo",
  "aiConfidence": 95,
  "aiAutoRun": {
    "enabled": false
  },
  "expected": "must not auto-run payout follow-up"
}
```

### 6. Tests Required

Required verification for this contract:

```bash
npx tsc --noEmit --pretty false
npx eslint --cache --cache-location .cache/.eslintcache --rule react-hooks-static-deps/exhaustive-deps:off src/components/customerService/v2/middle/CustomerServiceMessageList.tsx src/components/customerService/v2/setting/tabs/RuleEngineTab.tsx src/components/customerService/v2/setting/RuleEngineDoc.tsx src/global/helpers/customerServiceV2Settings.ts src/global/types/customerServiceV2.ts
git diff --check
```

Manual assertion points:

1. The default `/ds` playbook JSON includes `aiAutoRun.enabled=true` and `minConfidence=85`.
2. A high-confidence AI recommendation auto-runs the `/ds` playbook once.
3. Low-confidence recommendations remain manual.
4. `manualRunnable=false` hides the manual button without hiding the playbook from AI when `exposable=true`.

### 7. Wrong vs Correct

#### Wrong

```json
{
  "exposable": false,
  "aiAutoRun": {
    "enabled": true
  }
}
```

#### Correct

```json
{
  "exposable": true,
  "manualRunnable": true,
  "aiAutoRun": {
    "enabled": true,
    "minConfidence": 85
  }
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

## Scenario: Customer Service Suspend Gates

### 1. Scope / Trigger

Use this contract when a customer-service playbook must pause for human verification that may happen from another device:

```text
POST /api/customer-service/suspend-gate
GET /api/customer-service/suspend-gate?id=<gateId>
```

This is a cross-layer contract because the renderer creates the gate from a rule capability, the Node API proxy stores state in Redis, Telegram Bot API receives phone-side replies, and the renderer polls the backend to continue the pipeline.

### 2. Signatures

Renderer capability:

```ts
{
  id: 'suspend_for_human',
  type: 'checker',
  config: {
    titleTemplate?: string;
    promptTemplate?: string;
    timeout?: number; // seconds
    pollInterval?: number; // seconds
    controlChatId?: string;
    controlThreadId?: string;
  }
}
```

Renderer helper payload:

```ts
type CustomerServiceSuspendGatePayload = {
  idempotencyKey?: string;
  title?: string;
  prompt?: string;
  timeoutMs?: number;
  sourceChatId?: string;
  sourceMessageId?: number;
  caseId?: string;
  orderNumber?: string;
  ruleId?: string;
  ruleName?: string;
  stepId?: string;
  decisionContext?: Record<string, unknown>;
  controlChatId?: string;
  controlThreadId?: string;
  oncallConfig?: CustomerServiceOncallSettings;
};
```

Redis storage key:

```text
telegram_web:customer-service:suspend-gates
```

### 3. Contracts

The backend stores gates as JSON values in a Redis hash. Public gate responses must not expose the bot token.

```ts
type CustomerServiceSuspendGate = {
  id: string;
  idempotencyKey?: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  title: string;
  prompt: string;
  sourceChatId?: string;
  sourceMessageId?: number;
  caseId?: string;
  orderNumber?: string;
  ruleId?: string;
  ruleName?: string;
  stepId?: string;
  decisionContext?: Record<string, unknown>;
  controlChatId?: string;
  controlThreadId?: string;
  controlMessageId?: number;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  approvedBy?: string;
  approvalText?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  rejectionText?: string;
  error?: string;
};
```

`ONCALL_TELEGRAM_BOT_TOKEN` provides the bot token. The control chat resolves in this order:

1. Capability payload `controlChatId` / `controlThreadId`
2. Saved automation setting `oncall.suspendConfirmChatId` / `oncall.suspendConfirmThreadId`
3. Saved oncall alert groups: `newAlertChatId`, then processing/highest/holding alert chats

Phone-side confirmation works by replying to the bot confirmation message.

Approve text: `1`, `OK`, `okay`, `yes`, `approve`, `continue`, `确认`, `同意`, `继续`, `通过`, `可以`, `好了`.

Any other non-empty text reply to the bot confirmation message rejects the gate.

`decisionContext` is operator-facing context printed into the bot message. For payout no-funds it should include enough decision material to decide whether to continue, such as `/df` result, `/dolist` result, `ssn`, `supplierName`, `upstreamAlias`, `targetChatId`, and the planned `/fs` draft.

Gates have a timeout. Timeout only expires the gate; it must never auto-send an upstream message. Terminal or expired gate records are retained temporarily and pruned by `CUSTOMER_SERVICE_SUSPEND_RETENTION_MS` (default 7 days) during normal service scans.

### 4. Validation & Error Matrix

| Input / Condition | Server Behavior |
| --- | --- |
| Redis not configured | HTTP 503 with `Redis is not configured` |
| Missing `ONCALL_TELEGRAM_BOT_TOKEN` | HTTP 400 with token-required error |
| No control alert chat configured | HTTP 400 with control-chat-required error |
| Duplicate pending `idempotencyKey` | Return the existing pending gate; do not send another bot message |
| Gate expires while pending | Persist `status: expired`; renderer treats the capability as failed |
| Bot reply says approve | Persist `status: approved`; renderer deferred check continues the pipeline |
| Bot reply is any other non-empty text | Persist `status: rejected`; renderer deferred check fails the step |
| Web runtime is closed while gate is pending | Redis state remains until timeout/retention cleanup; no upstream message is sent automatically |
| Unknown gate id on GET | HTTP 404 with `Suspend gate not found` |

### 5. Good / Base / Bad Cases

Good case:

```json
{
  "title": "代付未到账视频确认: Payout123456",
  "prompt": "请人工检查资金流水视频，确认无误后 reply 1 / OK。",
  "timeoutMs": 7200000,
  "sourceChatId": "-1001",
  "sourceMessageId": 101,
  "orderNumber": "Payout123456",
  "ruleId": "case_payout_no_funds_demo",
  "stepId": "suspend_for_video_check",
  "decisionContext": {
    "dfReplyText": "success, amount 100000",
    "dolistReplyText": "ssn: ABC123456\n供应商: AgungSubsidiary-子账户4-APS-+DURIAN_PAY(160)",
    "ssn": "ABC123456",
    "supplierName": "AgungSubsidiary-子账户4-APS-+DURIAN_PAY(160)",
    "upstreamAlias": "DURIAN_PAY_160",
    "targetChatId": "-5230502865",
    "plannedDraft": "/fs ABC123456 user report no funds received."
  },
  "oncallConfig": {
    "suspendConfirmChatId": "-1002",
    "suspendConfirmThreadId": "42"
  }
}
```

Base case:

```json
{
  "title": "等待人工确认",
  "prompt": "请确认后 reply 1 / OK 继续。",
  "oncallConfig": {
    "suspendConfirmChatId": "-1002"
  }
}
```

Bad case:

```json
{
  "title": "等待人工确认",
  "prompt": "请确认后 reply 1 / OK 继续。"
}
```

The bad case fails when no oncall alert chat exists. Do not silently fall back to a hard-coded chat id.

### 6. Tests Required

Required verification for this contract:

```bash
node --check server/lib/customer-service-suspend-gates.mjs
node --check server/routes/customer-service-suspend-gate.mjs
node --check server/lib/telegram-bot.mjs
node --check server/index.mjs
npx tsc --noEmit --pretty false
git diff --check
```

Manual assertion points:

1. Creating a gate writes one Redis hash entry under `telegram_web:customer-service:suspend-gates`.
2. A duplicate pending `idempotencyKey` returns the same gate id.
3. Replying `OK` to the bot message changes the gate to `approved`.
4. Replying `1` to the bot message changes the gate to `approved`.
5. Replying any other non-empty text to the bot message changes the gate to `rejected`.
6. The renderer never receives `telegramBotToken`.

### 7. Wrong vs Correct

#### Wrong

Use `wait_for_reply` or an in-memory frontend confirmation map for a human check that may take minutes or happen from a phone.

#### Correct

Create a Redis-backed `suspend_for_human` gate, send a bot message to the control group, accept a reply to that bot message, and let the renderer poll the backend gate status before continuing.
