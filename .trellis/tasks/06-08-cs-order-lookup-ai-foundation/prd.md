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
* The user confirmed that any successful `/ds` result should be treated as resolved regardless of payment type; it should not be labeled only as VA.
* The user clarified payout no-funds flow: when intent is detected and the user provided video, `/df` can be automated, but video content verification remains manual.
* The payout flow should run `/dolist msn{orderNumber}` before the human suspend gate so the confirmation message can show `ssn`, supplier, target upstream group, and the planned `/fs user report no funds received.` draft before the operator decides whether to continue.
* The payout upstream step should not auto-send. On web it can be button-driven; on other devices the safest behavior is to leave a draft for manual send.
* The user approved a single-playbook payout flow with a `suspend` human gate instead of two disconnected playbooks.
* The `suspend` confirmation should be reliable across phone/desktop usage: backend stores the pending gate and sends a Telegram bot confirmation message to the operator/control group. The operator can reply to that bot message from a phone to approve continuation.
* Existing `wait_for_reply` is acceptable for short bot replies, but not for long human gates because the waiting closure lives in the Web runtime and is lost on reload/sleep/crash.

## Assumptions

* The immediate scope is foundation work, not tuning the actual order-lookup cases yet.
* Markdown knowledge material should remain editable by humans and usable by the AI chat endpoint.
* Image evidence may need a reference/storage strategy, but actual image ingestion can be scoped carefully after code inspection.

## Open Questions

* None. The user approved the hybrid record plus readable markdown approach and the backend-controlled suspend gate MVP.

## Requirements

* Identify all Redis keys introduced for customer-service AI and normalize their namespace.
* Make the default AI/knowledge markdown visible and editable through Redis-backed storage.
* Improve success-case material so it can be reviewed and used as future distillation/training material.
* Record image content descriptions and source message references without storing image binary data.
* Rename successful `/ds` case material from VA-specific wording to generic collection order lookup success.
* Split payout no-funds automation into an automatic `/df` stage and a manual-confirmed continuation stage after video verification.
* Add a persisted `suspend` gate for payout no-funds video verification.
* Send a confirmation message to the operator/control Telegram group and accept phone-side reply confirmation.
* Keep continuation execution in Web/Electron for now; backend owns the reliable gate state, not Telegram user-session operations.

## Acceptance Criteria

* [ ] Redis key names consistently use `telegram_web`.
* [ ] Default customer-service AI markdown is uploaded/seeded to the configured Redis key when no edited value exists.
* [ ] Success-case records have a human-readable representation suitable for review and future distillation.
* [ ] Image handling has an explicit storage/reference policy: describe image content and source references, do not store images.
* [ ] Payout no-funds playbook pauses after successful `/df` and asks for the customer's funds-flow video.
* [ ] Suspend gates are stored under the `telegram_web` Redis namespace and can be approved by replying `1` or another approved phrase to the bot confirmation message; any other non-empty text reply rejects the gate.
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
* Current `wait_for_reply` and pending capability confirmation state live in `src/global/helpers/ruleEngine.ts` memory. This supports short runtime waits but is not durable.
* Current `server/lib/oncall-store.mjs` is an in-memory store. The suspend MVP should use Redis directly instead of migrating all oncall state.
* Existing oncall bot settings already provide the backend bot token from `ONCALL_TELEGRAM_BOT_TOKEN`.
* Suspend confirmation now has a dedicated automation setting: `suspendConfirmChatId/suspendConfirmThreadId`; oncall alert groups are only fallback targets.
