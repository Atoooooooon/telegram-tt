# Customer Service Suspend Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted human-confirmation gate so payout no-funds playbooks can pause after `/df` success, wait for phone-side video verification confirmation, then continue in Web/Electron.

**Architecture:** Backend owns durable suspend state in Redis under the `telegram_web` namespace and sends a bot message to the automation confirmation group. A frontend `suspend_for_human` capability creates the gate, polls gate status, and resumes the existing pipeline when the backend marks it approved. Telegram user-session operations remain in the Web client; the backend does not send `/dolist` or upstream drafts.

**Tech Stack:** Node ESM Fastify proxy, Redis via `ioredis`, Telegram Bot API, Teact/TypeScript rule engine capabilities.

---

## File Structure

- Modify `.trellis/tasks/06-08-cs-order-lookup-ai-foundation/prd.md`: record the approved suspend-gate requirement.
- Modify `server/lib/redis-keys.mjs`: add `telegram_web:customer-service:suspend-gates`.
- Modify `server/lib/telegram-bot.mjs`: add `getUpdates` support for bot reply polling.
- Create `server/lib/customer-service-suspend-gates.mjs`: Redis-backed gate store, bot notification, and bot update polling.
- Create `server/routes/customer-service-suspend-gate.mjs`: create/get gate API used by the Web capability.
- Modify `server/index.mjs`: initialize suspend service, register routes, and close polling on shutdown.
- Modify `src/global/helpers/customerServiceOncall.ts`: add API helpers for create/get suspend gates.
- Modify `src/global/helpers/capabilities/checkers.ts`: add `suspend_for_human` capability.
- Modify `src/global/helpers/capabilities/index.ts`: register/export the new capability.
- Modify `src/global/helpers/customerServiceV2Settings.ts`: update collection wording and payout no-funds demo pipeline.
- Modify `docs/customer-service-oncall-scenarios.md`: describe the approved payout suspend flow and remote confirmation behavior.

## Task 1: Backend Suspend Gate Store

**Files:**
- Modify: `server/lib/redis-keys.mjs`
- Modify: `server/lib/telegram-bot.mjs`
- Create: `server/lib/customer-service-suspend-gates.mjs`

- [ ] **Step 1: Add a Redis key**

Add `CUSTOMER_SERVICE_SUSPEND_GATES: 'telegram_web:customer-service:suspend-gates'`.

- [ ] **Step 2: Add bot update polling primitive**

Add `TelegramBotClient.getUpdates(config, params)` using Telegram Bot API `getUpdates`.

- [ ] **Step 3: Implement suspend service**

Create a Redis hash-backed service with methods:

```js
async createGate(payload)
async getGate(gateId)
async close()
```

Each record contains `id`, `status`, source chat/message info, title, prompt, approval/rejection match metadata, control chat/thread/message refs, `createdAt`, `expiresAt`, and approval fields.

- [ ] **Step 4: Poll Telegram updates**

When pending gates exist, poll bot updates every 5 seconds. Approve a gate when an incoming message replies to the control message and text matches `1`, `OK`, `ok`, `确认`, `继续`, `approve`, or `yes`. Any other non-empty text reply rejects the gate.

## Task 2: Backend Routes

**Files:**
- Create: `server/routes/customer-service-suspend-gate.mjs`
- Modify: `server/index.mjs`

- [ ] **Step 1: Add POST route**

`POST /api/customer-service/suspend-gate` validates payload and calls `suspendService.createGate(payload)`.

- [ ] **Step 2: Add GET route**

`GET /api/customer-service/suspend-gate?id=<gateId>` returns the persisted gate status for polling.

- [ ] **Step 3: Wire route context**

Initialize the suspend service in `server/index.mjs`, pass it to route handlers as `suspendService`, and close it during shutdown.

## Task 3: Frontend Capability

**Files:**
- Modify: `src/global/helpers/customerServiceOncall.ts`
- Modify: `src/global/helpers/capabilities/checkers.ts`
- Modify: `src/global/helpers/capabilities/index.ts`

- [ ] **Step 1: Add typed API helpers**

Add `createCustomerServiceSuspendGate(payload)` and `getCustomerServiceSuspendGate(id)` with `ok/error/gate` result objects.

- [ ] **Step 2: Add `suspend_for_human` capability**

The capability renders title/prompt templates, posts a backend gate with current `pipelineData` and oncall config, then returns a deferred check. The deferred check polls backend status until approved/rejected/expired.

- [ ] **Step 3: Register the capability**

Register/export `suspend_for_human` with other checker capabilities.

## Task 4: Default Playbooks and Docs

**Files:**
- Modify: `src/global/helpers/customerServiceV2Settings.ts`
- Modify: `docs/customer-service-oncall-scenarios.md`

- [ ] **Step 1: Make `/ds` success generic**

Change VA-specific successful `/ds` summary/reason/intent to generic collection order lookup success.

- [ ] **Step 2: Update payout no-funds playbook**

After `/df` success, reply to the customer asking for the funds-flow video, send `/dolist msn{{orderNumber}}`, wait for reply, extract `ssn` and upstream routing fields where configured, then run `suspend_for_human` with the route decision printed in the confirmation message. After approval, prepare a text draft `/fs {{ssn}} user report no funds received.` in the upstream group. Current draft support does not guarantee attaching the customer video automatically.

- [ ] **Step 3: Document the split between automated and manual verification**

Document that video content is checked by a human, backend confirmation is durable, and continuation still runs from Web/Electron.

## Task 5: Verification

**Files:**
- All touched files.

- [ ] **Step 1: Syntax checks**

Run:

```bash
node --check server/lib/customer-service-suspend-gates.mjs
node --check server/routes/customer-service-suspend-gate.mjs
node --check server/lib/telegram-bot.mjs
node --check server/index.mjs
```

Expected: all commands pass.

- [ ] **Step 2: Type check**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: pass or only expose unrelated pre-existing failures.

- [ ] **Step 3: Whitespace check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

## Self-Review

Spec coverage: Redis namespace, backend confirmation, phone reply approval, Web-side continuation, and payout playbook changes are covered.

Placeholder scan: no open placeholders remain.

Type consistency: frontend uses `suspend_for_human`, `CustomerServiceSuspendGate`, `createCustomerServiceSuspendGate`, and `getCustomerServiceSuspendGate`; backend returns matching `gate` records.
