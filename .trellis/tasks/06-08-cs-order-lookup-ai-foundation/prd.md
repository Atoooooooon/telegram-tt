# Brainstorm: Customer Service Order Lookup AI Foundation

## Goal

Improve the foundation for customer-service collection/payout order lookup AI training so operators can understand and edit the prompt/knowledge material, collect success cases in a human-readable format, and keep Redis keys under a consistent `telegram_web` namespace.

## What I Already Know

* The user wants to optimize collection/payout order lookup later, but current customer cases are limited.
* The previous commit added an AI intent-recognition and success-case framework.
* Existing case material appears to be JSON-heavy and hard for the user to read.
* The user wants a default uploaded markdown/knowledge document available in Redis so they can see the key and edit it directly.
* Redis keys should use `telegram_web` instead of `telegram-tt`.
* `server/lib/customer-service-cloud-sync.mjs` already uses `telegram_web:config`, so the requested namespace matches existing cloud config style.
* `server/lib/customer-service-scenario-knowledge.mjs` currently reads `docs/customer-service-oncall-scenarios.md` as a fallback when Redis has no content, but it does not seed Redis.
* `server/lib/customer-service-success-cases.mjs` stores each success case as a JSON string in a Redis list.
* The customer-service workbench already has a resolved-case detail view, but raw metadata is rendered as pretty JSON.
* The AI chat proxy supports inline image input for a single request, but the success-case store does not have an image persistence policy.
* The user confirmed that success cases should include a description of image content because the project already uses vision-capable models.
* The user confirmed that images themselves should not be stored in this foundation pass.

## Assumptions

* The immediate scope is foundation work, not tuning the actual order-lookup cases yet.
* Markdown knowledge material should remain editable by humans and usable by the AI chat endpoint.
* Image evidence may need a reference/storage strategy, but actual image ingestion can be scoped carefully after code inspection.

## Open Questions

* None. The user approved the hybrid record plus readable markdown approach.

## Requirements

* Identify all Redis keys introduced for customer-service AI and normalize their namespace.
* Make the default AI/knowledge markdown visible and editable through Redis-backed storage.
* Improve success-case material so it can be reviewed and used as future distillation/training material.
* Record image content descriptions and source message references without storing image binary data.

## Acceptance Criteria

* [ ] Redis key names consistently use `telegram_web`.
* [ ] Default customer-service AI markdown is uploaded/seeded to the configured Redis key when no edited value exists.
* [ ] Success-case records have a human-readable representation suitable for review and future distillation.
* [ ] Image handling has an explicit storage/reference policy: describe image content and source references, do not store images.
* [ ] Relevant UI/API code paths still load and save knowledge/cases successfully.

## Definition of Done

* Tests or focused verification are run where practical.
* Lint/type checks are run if the touched areas are covered by existing scripts.
* Documentation/notes are updated if behavior changes.
* Rollback is straightforward because data key changes are isolated and described.

## Out of Scope

* Full order-lookup AI behavior optimization with many real customer cases.
* Building a complete image upload/storage service unless the current code already supports it cleanly.

## Technical Notes

* Recent commit under review: `6beecf939 add: ai 加入`.
* Relevant files found so far include `server/lib/redis-keys.mjs`, `server/lib/customer-service-scenario-knowledge.mjs`, `server/lib/customer-service-success-cases.mjs`, and customer-service AI routes.
* Frontend resolved-case files under review include `src/global/helpers/customerServiceOncall.ts` and `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`.
