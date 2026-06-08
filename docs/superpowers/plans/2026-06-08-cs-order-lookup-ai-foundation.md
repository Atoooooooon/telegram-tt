# Customer Service Order Lookup AI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize customer-service AI Redis keys, seed default markdown knowledge, and make success cases readable for future order-lookup distillation.

**Architecture:** Keep the existing Redis-backed service modules and add minimal fields to the success-case record contract. Scenario knowledge seeds the default markdown into Redis on first successful Redis read miss. Success cases remain JSON list entries but include generated markdown plus image descriptions and references.

**Tech Stack:** Node ESM API proxy, Redis via `ioredis`, Teact/TypeScript frontend, SCSS modules.

---

## File Structure

- Modify `server/lib/redis-keys.mjs`: change key namespace to `telegram_web`.
- Modify `server/lib/customer-service-scenario-knowledge.mjs`: seed default markdown into Redis when missing.
- Modify `server/lib/customer-service-success-cases.mjs`: normalize image reference fields and generate readable markdown.
- Modify `src/global/helpers/customerServiceOncall.ts`: add frontend types for markdown and image references.
- Modify `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`: pass image reference descriptions when resolving a case and render markdown in resolved-case detail.
- Modify `src/components/customerService/v2/middle/CustomerServiceMessageList.module.scss`: style readable markdown if needed.

## Task 1: Normalize Redis Keys

**Files:**
- Modify: `server/lib/redis-keys.mjs`

- [ ] **Step 1: Replace old namespace with `telegram_web`**

```js
export const REDIS_KEYS = Object.freeze({
  ONCALL_CONFIG: 'telegram_web:oncall:config',
  CUSTOMER_SERVICE_SUCCESS_CASES: 'telegram_web:customer-service:success-cases',
  CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE: 'telegram_web:customer-service:scenario-knowledge',
});
```

- [ ] **Step 2: Search for remaining old keys**

Run: `rg -n "telegram-tt:|telegram_web:" server src docs .trellis -S --glob '!node_modules'`

Expected: no `telegram-tt:` Redis keys remain except unrelated repository-path text.

## Task 2: Seed Default Scenario Knowledge

**Files:**
- Modify: `server/lib/customer-service-scenario-knowledge.mjs`

- [ ] **Step 1: Add a helper that reads default markdown once**

Use the existing `readFallbackKnowledge` behavior as the source of truth for default content.

- [ ] **Step 2: On Redis miss, write default markdown into `REDIS_KEYS.CUSTOMER_SERVICE_SCENARIO_KNOWLEDGE`**

The successful seeded response should return:

```js
{
  record: { format: 'markdown', content: normalizedContent, updatedAt },
  source: 'redis-seeded',
  unavailable: false
}
```

If seeding fails, return fallback content with `source: 'fallback'`, `unavailable: true`, and the seed error.

- [ ] **Step 3: Verify by reading the function path**

Run: `node --check server/lib/customer-service-scenario-knowledge.mjs`

Expected: no syntax errors.

## Task 3: Add Readable Success-Case Material

**Files:**
- Modify: `server/lib/customer-service-success-cases.mjs`

- [ ] **Step 1: Normalize image references**

Accept payload fields:

```js
imageSummary: string | undefined
imageReferences: Array<{
  chatId?: string;
  messageId?: number;
  description?: string;
  source?: 'vision_model' | 'operator' | 'message_context';
}>
```

Drop empty entries and do not store image binary data.

- [ ] **Step 2: Generate markdown from the normalized record**

Include sections for:

```markdown
# Success Case: <intent or record type>

## Summary
...

## Source Case
...

## Image Notes
...

## AI Draft
...

## Final Reply
...

## Execution Notes
...
```

- [ ] **Step 3: Keep deletion/list behavior compatible**

Existing list consumers should still receive JSON objects. Old records without `markdown` should still parse and render via fallback UI.

- [ ] **Step 4: Verify syntax**

Run: `node --check server/lib/customer-service-success-cases.mjs`

Expected: no syntax errors.

## Task 4: Update Frontend Types and Resolved Case Payload

**Files:**
- Modify: `src/global/helpers/customerServiceOncall.ts`
- Modify: `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`

- [ ] **Step 1: Add frontend types**

Add `CustomerServiceSuccessCaseImageReference`, optional `imageSummary`, optional `imageReferences`, and optional `markdown`.

- [ ] **Step 2: Build image notes when marking a case resolved**

Use `contextMediaMessages` to create references:

```ts
imageReferences: contextMediaMessages.map((message) => ({
  chatId: message.chatId,
  messageId: message.id,
  description: getMessageSummaryText(lang, message, undefined, true, 160),
  source: 'message_context',
}))
```

The description is a lightweight source/context description. It does not store the image.

- [ ] **Step 3: Render markdown first in resolved-case detail**

When `selectedResolvedCase.markdown` exists, show it in a preformatted readable block before structured fallback sections.

## Task 5: Style and Verify

**Files:**
- Modify if needed: `src/components/customerService/v2/middle/CustomerServiceMessageList.module.scss`

- [ ] **Step 1: Add a readable markdown block class if no existing class fits**

Use the current detail text/card styling and preserve wrapping:

```scss
.resolvedDetailMarkdown {
  white-space: pre-wrap;
  word-break: break-word;
}
```

- [ ] **Step 2: Run checks**

Run these commands based on touched files:

```bash
node --check server/lib/customer-service-scenario-knowledge.mjs
node --check server/lib/customer-service-success-cases.mjs
npm run check:ts
npm run check:css
```

Expected: syntax checks pass. Type/CSS checks should pass or expose only unrelated pre-existing failures.

## Self-Review

Spec coverage:

- Redis namespace covered by Task 1.
- Scenario markdown seed covered by Task 2.
- Hybrid readable success cases covered by Task 3.
- Image description/no image storage covered by Tasks 3 and 4.
- UI review surface covered by Tasks 4 and 5.

Placeholder scan: no implementation placeholders remain.

Type consistency: frontend and backend both use `imageSummary`, `imageReferences`, and `markdown`.
