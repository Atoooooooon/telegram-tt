# Customer Service Forward Modes

## Goal
Extend the customer service rule engine forwarding capability so one rule action can either:
- forward the original Telegram message natively
- copy the message text and send a new composed message

## Requirements
- Extend `action_forward` instead of creating another overlapping action.
- Support a forwarding mode switch between native forward and copied-text send.
- In copied-text mode, support template-based composition so operators can prepend/append extra content.
- Keep compatibility with existing `action_forward` rules that only provide `toChatId`.
- Reuse existing rule-engine pipeline data such as chat title and message text.
- Keep customer service rule documentation aligned with the new capability behavior.

## Acceptance Criteria
- [ ] Existing `action_forward` configs still work as native forwarding without migration.
- [ ] `action_forward` supports a copy-text mode that sends a new message to the target chat.
- [ ] Copy-text mode supports placeholders for source group name and original text.
- [ ] Missing required config in copy-text mode fails safely with a clear error.
- [ ] Rule engine docs describe both modes and the supported placeholders.

## Technical Notes
- Prefer reusing the existing template renderer and pipeline data rather than inventing a second formatter.
- Keep type/config additions local to the capability unless multiple modules need a shared constant.
