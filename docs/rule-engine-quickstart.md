# 快速开始 - 规则引擎

5分钟快速上手规则引擎,实现你的第一个自动化规则。

---

## 🚀 场景: AI说"已解决"自动标记已读

### 步骤1: 启用规则引擎

修改客服设置,添加规则引擎配置:

```typescript
// 在 CustomerServiceSettings 中
{
  // ... 现有配置 ...

  // 启用规则引擎
  ruleEngineConfig: {
    enabled: true,           // 开启规则引擎
    fallbackToLegacy: true,  // 无规则匹配时使用旧逻辑
    maxExecutionTime: 5000,  // 单条规则最大执行时间(ms)
  },

  // 规则列表
  rules: []  // 先留空,下一步添加
}
```

### 步骤2: 创建第一条规则

添加一条规则到 `rules` 数组:

```typescript
rules: [
  {
    id: 'my_first_rule',              // 唯一ID
    name: 'AI解决问题自动已读',        // 显示名称
    enabled: true,                     // 启用规则
    priority: 10,                      // 优先级(数字越大越优先)

    // 什么时候触发这条规则?
    trigger: {
      eventType: 'bot_reply',          // 监听机器人回复
      senderIds: ['YOUR_BOT_ID_HERE'], // 替换为你的AI机器人ID
    },

    // 触发后怎么处理?
    pipeline: [
      // 步骤1: 检查回复内容是否包含"已解决"
      {
        id: 'step1',
        capabilityId: 'check_text_match',  // 使用文本匹配能力
        config: {
          pattern: '已为您解决|问题已处理',  // 匹配模式
          mode: '正则',                     // 匹配方式
        },
        onSuccess: {
          continueNext: true,  // 匹配成功,继续下一步
        },
        onFailure: {
          stopPipeline: true,  // 不匹配就停止
        },
      },

      // 步骤2: 标记原消息为已读
      {
        id: 'step2',
        capabilityId: 'action_mark_read',  // 使用标记已读能力
        config: {
          targetMessage: '回复的原消息',      // 标记哪条消息
        },
      },
    ],
  }
]
```

### 步骤3: 测试规则

1. **发送测试消息**: 在监控的群组中发一条消息
2. **让AI回复**: AI机器人回复"已为您解决"
3. **查看效果**: 原消息应该自动从客服队列移除(标记已读)
4. **查看日志**: 打开浏览器控制台,应该看到:
```
[RuleEngine] Executing rule: AI解决问题自动已读
  Step 1: 文本匹配检测
  Step 2: 标记为已读
```

---

## 📝 更多场景

### 场景2: 关键词自动回复

```typescript
{
  id: 'auto_reply_faq',
  name: '常见问题自动回复',
  enabled: true,
  trigger: {
    eventType: 'customer_message',  // 监听客户消息
  },
  pipeline: [
    {
      id: 'check',
      capabilityId: 'check_text_match',
      config: {
        pattern: '营业时间|几点开门',
        mode: '正则',
      },
      onFailure: { stopPipeline: true },
    },
    {
      id: 'reply',
      capabilityId: 'action_auto_reply',
      config: {
        template: '我们的营业时间是 9:00-18:00',
        replyToOriginal: true,
      },
    },
  ],
}
```

### 场景3: 消息去重

```typescript
{
  id: 'dedup',
  name: '已回复消息不进队列',
  enabled: true,
  trigger: {
    eventType: 'customer_message',
  },
  pipeline: [
    {
      id: 'check',
      capabilityId: 'check_has_reply',
      config: {
        timeWindow: 600,  // 10分钟内的回复
      },
      onSuccess: {
        continueNext: false,  // 已回复,不进队列
      },
      onFailure: {
        executeAction: 'action_add_queue',  // 未回复,添加到队列
      },
    },
  ],
}
```

---

## 🛠️ 可用能力速查

### 检测类
| 能力ID | 名称 | 用途 |
|--------|------|------|
| `check_text_match` | 文本匹配 | 检查消息是否包含关键词 |
| `check_has_reply` | 回复检测 | 检查消息是否已被回复 |

### 动作类
| 能力ID | 名称 | 用途 |
|--------|------|------|
| `action_mark_read` | 标记已读 | 从客服队列移除消息 |
| `action_auto_reply` | 自动回复 | 发送自动回复消息 |
| `action_add_queue` | 添加到队列 | 添加消息到客服队列 |

---

## 🐛 常见问题

**Q: 规则不生效?**
```typescript
// 检查这三个地方:
1. ruleEngineConfig.enabled === true ✓
2. rule.enabled === true ✓
3. trigger 条件是否匹配 ✓
```

**Q: 如何获取机器人ID?**
```typescript
// 方法1: 在群组中查看机器人消息的 senderId
// 方法2: 在客服设置的 filteredUserIds 中找
// 方法3: 浏览器控制台执行:
selectUser(global, 'bot_username').id
```

**Q: 如何调试规则?**
```typescript
// 打开浏览器控制台,查看日志:
[RuleEngine] Executing rule: xxx
  Step 1: xxx  ✅ 成功
  Step 2: xxx  ❌ 失败: error message
```

---

## 📚 下一步

- 查看更多示例: [rule-engine-examples.md](./rule-engine-examples.md)
- 学习能力开发: [rule-engine-api-reference.md](./rule-engine-api-reference.md)
- 了解完整架构: [customer-service-rule-engine.md](./customer-service-rule-engine.md)

---

**祝你配置成功! 🎉**
