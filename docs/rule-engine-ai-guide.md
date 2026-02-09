# Rule Engine AI Generation Guide

This document is designed for AI agents (like Gemini, Claude, GPT) to help them generate valid JSON configurations for the Telegram TT Rule Engine.

## System Context
The Rule Engine processes incoming Telegram messages (from customers or bots) through a pipeline of "Capabilities".

### Core Data Structure
- **PipelineData**: A shared object passed between steps.
  - Initial keys: `message`, `chatId`, `senderId`, `text`.
  - Capabilities can add new keys (e.g., `extractedRrn`, `apiResponse`).
  - Use `{{key}}` syntax in templates to reference these values.

## Available Capabilities (Schema)

### 1. Checkers (Conditional Logic)
| capabilityId | Description | Key Config | Success Condition |
|--------------|-------------|------------|-------------------|
| `check_message` | Check text/media | `textPattern`, `textMode`, `checkHasPhoto` | All enabled checks pass |
| `check_has_reply` | Async check for reply | `timeWindow` (seconds) | Reply found after delay |
| `wait_for_reply` | Wait for reply to specific msg | `chatId`, `messageIdField`, `timeout` | Specific reply found |

### 2. Extractors (Data Processing)
| capabilityId | Description | Output Fields |
|--------------|-------------|---------------|
| `ocr_image` | OCR from image | `ocrText`, `ocrLines` |
| `text_processor` | Regex/Clean/Transform | Configurable (default `extractedText`) |
| `call_api` | External HTTP call | `apiResponse`, `statusCode` |

### 3. Actions (Operations)
| capabilityId | Description | Key Config |
|--------------|-------------|------------|
| `action_auto_reply` | Reply in current chat | `template` (supports `{{vars}}`) |
| `action_send_to` | Send msg to other chat | `toChatId`, `template`. Returns `sentMessageId` |
| `action_mark_read` | Remove from CS queue | `targetMessage` |
| `action_forward` | Forward message | `toChatId` |

## Pipeline Routing
Each step can have:
- `onSuccess`: `{ continueNext: boolean, gotoStep: string, executeAction: string }`
- `onFailure`: `{ stopPipeline: boolean, gotoStep: string, executeAction: string }`

## Common Recipes

### OCR -> External Query -> Reply
```json
{
  "name": "OCR Query",
  "trigger": { "eventType": "customer_message" },
  "pipeline": [
    { "capabilityId": "check_message", "config": { "checkHasPhoto": true }, "onFailure": { "stopPipeline": true } },
    { "capabilityId": "ocr_image", "config": { "provider": "baidu" } },
    { "capabilityId": "text_processor", "config": { "extractEnabled": true, "extractPattern": "ID:(\d+)", "outputField": "id" } },
    { "capabilityId": "action_auto_reply", "config": { "template": "Found ID: {{id}}" } }
  ]
}
```

### Cross-Group Bot Query
```json
{
  "name": "Cross Group Bot Query",
  "trigger": { "eventType": "customer_message" },
  "pipeline": [
    { "capabilityId": "action_send_to", "config": { "toChatId": "BOT_GROUP_ID", "template": "/query {{text}}" } },
    { "capabilityId": "wait_for_reply", "config": { "chatId": "BOT_GROUP_ID", "messageIdField": "sentMessageId" } },
    { "capabilityId": "action_auto_reply", "config": { "template": "Bot said: {{botReplyText}}" } }
  ]
}
```

## AI Best Practices
1. **Always use IDs**: Ensure every pipeline step has a unique `id` if you use `gotoStep`.
2. **Handle Failures**: Always include `onFailure: { "stopPipeline": true }` for critical checks (like photo presence).
3. **Template Safety**: Use `{{text}}` to refer to the original message text.
4. **Chat IDs**: Remember that Telegram Chat IDs are strings (e.g., `"-10012345678"`).
