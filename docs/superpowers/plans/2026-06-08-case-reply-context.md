# Case Reply Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose reply-to source messages as first-class customer-service case context for AI recommendations, playbooks, follow-up automation, and success-case material.

**Architecture:** Keep `caseMessages` as the current grouped case messages. Add derived context fields beside it: `caseReplyMessages`, `caseReplyText`, and `caseContextMessages`, then use `caseContextText` where intent/order extraction needs the full operator context.

**Tech Stack:** Electron renderer, React/Teact, TypeScript, customer-service rule engine pipeline data.

---

### Task 1: Build Reply Context From Case Messages

**Files:**
- Modify: `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`

- [x] Add `selectReplyMessage` import from `global/selectors/messages`.
- [x] Add helpers that resolve loaded reply-to messages, dedupe by `chatId:id`, summarize them with `getMessageSummaryText`, and compose:
  - `caseReplyMessages: ApiMessage[]`
  - `caseReplyText: string`
  - `caseContextMessages: ApiMessage[]`
  - `caseContextText: string`
- [x] Leave unloaded reply-to messages out of the structured arrays; do not fabricate message objects.

### Task 2: Feed Extended Context To AI And Playbooks

**Files:**
- Modify: `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`

- [x] Use `caseContextText` for manual playbook field matching and order-number extraction.
- [x] Include reply context fields in `executeRule` initial pipeline data.
- [x] Use combined context in AI playbook recommendation prompt and request cache key.

### Task 3: Preserve Context In Follow-Up Automation And Success Cases

**Files:**
- Modify: `src/global/helpers/capabilities/actions.ts`
- Modify: `src/components/customerService/v2/middle/CustomerServiceMessageList.tsx`

- [x] Update media lookup so `case_first_media` and `case_last_media` can use `caseContextMessages`, falling back to `caseMessages`.
- [x] Save `caseReplyText` and reply source IDs in success-case metadata.

### Task 4: Document Pipeline Contract And Verify

**Files:**
- Modify: `src/global/types/customerServiceV2.ts`
- Modify: `src/components/customerService/v2/setting/RuleEngineDoc.tsx`
- Modify: `.trellis/spec/backend/customer-service-ai.md`

- [x] Add pipeline variable definitions for reply/context fields.
- [x] Document that reply-to context is best effort: only loaded Telegram messages are included.
- [x] Run `npx tsc --noEmit --pretty false`.
- [x] Run focused ESLint on touched TypeScript files with the known broken hooks rule disabled.
- [x] Run `git diff --check`.
