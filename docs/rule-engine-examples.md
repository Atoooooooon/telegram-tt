# 规则引擎使用示例

这个文件展示如何配置规则引擎来实现各种业务场景。

## 配置位置

规则配置存储在 `CustomerServiceSettings.rules` 数组中。

可以通过客服设置UI配置,或直接修改存储的JSON。

## 示例1: AI机器人说"已解决"自动标记已读

```typescript
const ruleAiAutoResolve: UserRule = {
  id: 'rule_ai_auto_resolve',
  name: 'AI解决问题自动已读',
  enabled: true,
  priority: 10,

  // 触发条件: 监听机器人回复
  trigger: {
    eventType: 'bot_reply',
    senderIds: ['bot_ai_assistant_id'], // 替换为你的AI机器人ID
  },

  // 处理步骤
  pipeline: [
    // 步骤1: 检测回复内容是否包含"已解决"
    {
      id: 'step1_check_resolved',
      capabilityId: 'check_text_match',
      config: {
        pattern: '已为您解决|问题已处理|已帮您查询',
        mode: '正则',
      },
      onSuccess: {
        continueNext: true, // 继续执行下一步
      },
      onFailure: {
        stopPipeline: true, // 不匹配就停止
      },
    },

    // 步骤2: 标记原消息为已读
    {
      id: 'step2_mark_read',
      capabilityId: 'action_mark_read',
      config: {
        targetMessage: '回复的原消息',
      },
    },
  ],
};
```

## 示例2: 消息去重(已回复的消息不再进队列)

```typescript
const ruleDeduplicate: UserRule = {
  id: 'rule_dedup',
  name: '消息去重检查',
  enabled: true,
  priority: 5,

  trigger: {
    eventType: 'customer_message',
  },

  pipeline: [
    // 检查是否已有人回复
    {
      id: 'check_reply',
      capabilityId: 'check_has_reply',
      config: {
        timeWindow: 600, // 10分钟内的回复
      },
      onSuccess: {
        continueNext: false, // 已回复,停止(不添加到队列)
      },
      onFailure: {
        executeAction: 'action_add_queue', // 未回复,添加到队列
      },
    },
  ],
};
```

## 示例3: AI转人工检测

```typescript
const ruleAiTransferManual: UserRule = {
  id: 'rule_ai_transfer',
  name: 'AI转人工检测',
  enabled: true,
  priority: 10,

  trigger: {
    eventType: 'bot_reply',
    senderIds: ['bot_ai_assistant_id'],
  },

  pipeline: [
    // 检测AI是否说"需要人工"
    {
      id: 'check_manual',
      capabilityId: 'check_text_match',
      config: {
        pattern: '需要人工|无法处理|转人工',
        mode: '正则',
      },
      onSuccess: {
        executeAction: 'action_add_queue', // 匹配就添加到队列
      },
    },
  ],
};
```

## 示例4: 关键词自动回复

```typescript
const ruleAutoReplyFAQ: UserRule = {
  id: 'rule_auto_faq',
  name: '常见问题自动回复',
  enabled: true,
  priority: 8,

  trigger: {
    eventType: 'customer_message',
  },

  pipeline: [
    // 检测是否问营业时间
    {
      id: 'check_hours',
      capabilityId: 'check_text_match',
      config: {
        pattern: '营业时间|几点开门|工作时间',
        mode: '正则',
      },
      onSuccess: {
        continueNext: true,
      },
      onFailure: {
        stopPipeline: true,
      },
    },

    // 自动回复营业时间
    {
      id: 'reply_hours',
      capabilityId: 'action_auto_reply',
      config: {
        template: '我们的营业时间是:\n周一至周五: 9:00-18:00\n周六周日: 10:00-17:00',
        replyToOriginal: true,
      },
    },
  ],
};
```

## 完整配置示例

将以上规则添加到设置中:

```typescript
// 在 customerServiceV2.settings 中
const settings: CustomerServiceSettings = {
  // ... 现有配置 ...

  // 启用规则引擎
  ruleEngineConfig: {
    enabled: true,
    fallbackToLegacy: true, // 无规则匹配时使用旧逻辑
    maxExecutionTime: 5000,
  },

  // 规则列表
  rules: [
    ruleAiAutoResolve,
    ruleDeduplicate,
    ruleAiTransferManual,
    ruleAutoReplyFAQ,
  ],
};
```

## 配置说明

### 优先级 (priority)
- 数字越大优先级越高
- 只执行第一个匹配的规则
- 建议: 特殊规则10, 一般规则5, 默认规则0

### 触发条件 (trigger)
- `eventType`:
  - `customer_message`: 客户发的消息
  - `bot_reply`: 机器人回复
  - `any_message`: 任意消息
- `chatIds`: 限定群组(可选,不填=所有监控群组)
- `senderIds`: 限定发送者(可选,不填=所有)

### 管道步骤 (pipeline)
- `capabilityId`: 能力ID (参考API文档)
- `config`: 能力配置参数
- `onSuccess/onFailure`: 路由逻辑
  - `continueNext`: 继续下一步
  - `stopPipeline`: 停止管道
  - `executeAction`: 执行指定动作

## 可用能力列表

### 检测类 (Checkers)
- `check_text_match`: 文本匹配
- `check_has_reply`: 回复检测

### 动作类 (Actions)
- `action_mark_read`: 标记已读
- `action_auto_reply`: 自动回复
- `action_add_queue`: 添加到队列

更多能力参考 API 文档。

## 调试技巧

1. 查看控制台日志:
```
[RuleEngine] Executing rule: xxx
  Step 1: xxx
  Step 2: xxx
```

2. 测试单条规则:
```typescript
// 在浏览器控制台
await executeRule(testRule, testMessage, global, actions);
```

3. 检查规则是否生效:
```typescript
const settings = selectCustomerServiceV2Settings(global);
console.log('Rules:', settings?.rules);
console.log('Engine enabled:', settings?.ruleEngineConfig?.enabled);
```

## 常见问题

**Q: 规则不生效?**
A: 检查 `ruleEngineConfig.enabled` 是否为 true, `rule.enabled` 是否为 true

**Q: 如何禁用旧逻辑?**
A: 设置 `ruleEngineConfig.fallbackToLegacy = false`

**Q: 能力执行失败?**
A: 查看控制台错误日志,检查 config 参数是否正确

**Q: 如何添加自定义能力?**
A: 参考 API 文档的"能力开发指南"章节
