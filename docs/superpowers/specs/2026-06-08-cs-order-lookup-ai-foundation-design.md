# Customer Service Order Lookup AI Foundation Design

## Context

The previous AI framework added Redis-backed customer-service scenario knowledge and a success-case store. The current foundation is useful for iteration, but two pieces are hard to operate:

1. Redis keys use the old `telegram-tt` namespace while existing cloud configuration already uses `telegram_web`.
2. Success cases are stored as JSON list entries, which keeps machine-readable fields but is poor material for human review and future distillation.

The user also wants the default scenario markdown to be uploaded into Redis so the key is visible and directly editable. Cases should mention image content because vision-capable models are already part of the workflow, but image files themselves should not be stored in this pass.

## Goals

1. Normalize customer-service AI Redis keys under `telegram_web`.
2. Seed default scenario knowledge into Redis when the Redis key is missing.
3. Preserve structured success-case fields while adding a human-readable markdown artifact.
4. Capture image content descriptions and source message references in success cases without storing image binary data.

## Non-Goals

1. No full order-lookup prompt tuning in this pass.
2. No image upload service, object storage integration, or Redis base64 image persistence.
3. No schema migration for old `telegram-tt` Redis data unless explicitly requested later.

## Approach

Use a hybrid success-case format. Each Redis list entry remains JSON so existing code can list, delete, and filter records. The normalized record gains optional fields for image references and a generated `markdown` field that summarizes the case in a reviewable format.

Scenario knowledge keeps the existing markdown fallback file. On a Redis miss, the server reads the default markdown and attempts to write it to `telegram_web:customer-service:scenario-knowledge`; the API response identifies the source as seeded Redis content when the write succeeds, or fallback content when Redis is unavailable.

## Data Contracts

### Redis Keys

```text
telegram_web:oncall:config
telegram_web:customer-service:success-cases
telegram_web:customer-service:scenario-knowledge
```

### Success Case Record Additions

```ts
type CustomerServiceSuccessCaseImageReference = {
  chatId?: string;
  messageId?: number;
  description?: string;
  source?: 'vision_model' | 'operator' | 'message_context';
};

type CustomerServiceSuccessCaseRecord = {
  // Existing fields stay intact.
  imageReferences?: CustomerServiceSuccessCaseImageReference[];
  imageSummary?: string;
  markdown?: string;
};
```

`imageReferences` describes where image evidence came from and what it showed. `imageSummary` is a compact aggregate sentence for distillation. `markdown` is generated server-side from structured fields and image fields.

## Image Policy

Images are not stored in Redis. Success cases store only:

1. Source chat/message identifiers when known.
2. A short image content description.
3. Whether the description came from a vision model, operator, or message context.

This keeps Redis small and avoids retaining sensitive screenshots while still making the case useful for AI training review. Vision-capable runtime requests can continue using the current inline image request path.

## UI Impact

The resolved-case detail page should prefer the `markdown` field when present. Existing structured sections remain as fallback and are still useful for quick scanning. Metadata JSON can remain available for debugging, but the default review surface should be the readable case material.

## Error Handling

Redis unavailable behavior remains graceful:

1. Scenario knowledge returns fallback markdown with `unavailable: true`.
2. Saving scenario knowledge and success cases still returns HTTP 503 when Redis is not configured.
3. Seeding failures should not hide fallback knowledge; the API should return fallback content and include the seed error.

## Verification

1. Run a focused Node script or route-level smoke check for scenario-knowledge Redis miss behavior with a fake Redis client if practical.
2. Run `npm run check:ts` after touching TypeScript.
3. Run `npm run check:css` only if SCSS changes are made.
4. Manually inspect generated markdown strings from sample success-case payloads.
