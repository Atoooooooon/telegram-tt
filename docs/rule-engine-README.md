# 客服规则引擎 - 文档索引

本目录包含客服规则引擎的完整技术文档。

---

## 📚 文档列表

### 1. [技术方案文档](./customer-service-rule-engine.md)

**适合人群**: 产品经理、技术负责人、架构师

**内容概览**:
- 项目背景和需求分析
- 技术选型对比(json-rules-engine vs expr-eval vs quickjs-emscripten vs 自研)
- 整体架构设计(能力插件化 + 管道执行)
- 实施计划(14人天,分4个阶段)
- 风险评估与缓解措施

**快速预览**:
```
核心设计: 能力插件化架构
技术栈: 自研引擎(~500行) + expr-eval(20KB)
工期: ~3周(MVP 3天可用)
```

---

### 2. [API 参考文档](./rule-engine-api-reference.md)

**适合人群**: 开发人员、能力开发者

**内容概览**:
- 核心 API 使用说明
  - `registerCapability()`: 注册新能力
  - `executeRule()`: 执行规则
  - `processMessageWithRules()`: 引擎主入口
- 能力开发完整指南
  - 接口定义
  - 开发步骤
  - 最佳实践(DO & DON'T)
- 内置能力参考(包含检测、提取、动作类能力)
  - 检测类: check_message, check_has_reply
  - 动作类: action_mark_read, action_auto_reply, action_add_queue, action_forward, action_send_to
- 配置示例和工具函数

**快速预览**:
```typescript
// 注册自定义能力
registerCapability({
  id: 'my_checker',
  name: '自定义检测',
  type: 'checker',
  configSchema: { /* ... */ },
  async execute(input) { /* ... */ }
});
```

---

## 🚀 快速开始

### 1. 阅读顺序建议

**对于产品/管理人员**:
1. 技术方案文档 → 第1-2节(了解背景和需求)
2. 技术方案文档 → 第7节(了解实施计划)

**对于开发人员**:
1. 技术方案文档 → 第3-4节(技术选型和架构)
2. API参考文档 → 第2-3节(能力开发和API使用)
3. 技术方案文档 → 第5-6节(数据模型和详细设计)

**对于能力开发者**:
1. API参考文档 → 第2节(能力开发指南)
2. API参考文档 → 第3节(内置能力参考,学习示例)

### 2. 关键概念

| 概念 | 定义 | 文档位置 |
|-----|------|---------|
| **能力(Capability)** | 可复用的功能模块,如文本匹配、OCR识别、自动回复 | 技术方案§5, API§2 |
| **规则(Rule)** | 用户配置的消息处理流程,包含触发条件和管道步骤 | 技术方案§6.1, API§4 |
| **管道(Pipeline)** | 多个能力按顺序组合的处理流程 | 技术方案§4.2 |
| **管道数据(PipelineData)** | 管道执行过程中累积的数据,供后续步骤使用 | API§2.2 |
| **条件路由** | 根据步骤执行结果决定下一步走向 | API§4.2 |

### 3. 典型使用场景

```typescript
// 场景1: AI说"已解决"自动标记已读
{
  trigger: { eventType: 'bot_reply', senderIds: ['bot_ai'] },
  pipeline: [
    { capabilityId: 'check_text_match', config: { pattern: '已解决', mode: '包含' } },
    { capabilityId: 'action_mark_read', config: { targetMessage: '回复的原消息' } }
  ]
}

// 场景2: OCR识别→API查询→自动回复
{
  trigger: { eventType: 'customer_message' },
  pipeline: [
    { capabilityId: 'check_has_media', config: { mediaType: 'photo' } },
    { capabilityId: 'extract_ocr', config: { language: 'chi_sim+eng', extractPattern: '[A-Z0-9]{10,15}' } },
    { capabilityId: 'call_api', config: { url: 'https://api.com/order', method: 'POST', bodyTemplate: '{"orderId":"{{extracted}}"}' } },
    { capabilityId: 'action_auto_reply', config: { template: '订单{{extracted}}状态: {{apiResponse.status}}' } }
  ]
}
```

---

## 📊 项目状态

| 指标 | 当前值 | 备注 |
|-----|-------|------|
| **状态** | 📝 待评审 | 文档已完成,等待决策 |
| **预估工期** | 14人天 | 约3周(含测试和优化) |
| **MVP工期** | 3人天 | 核心引擎+3个基础能力 |
| **代码量** | ~500行 | 不含UI界面 |
| **新增依赖** | 1个(expr-eval, 20KB) | 符合项目"最小依赖"原则 |

---

## 🔗 相关资源

### 项目文件
- **现有客服代码**: `src/global/actions/ui/customerServiceV2*.ts`
- **类型定义**: `src/global/types/customerServiceV2.ts`
- **配置文件**: `src/config/customerService.ts`

### 外部参考
- [expr-eval GitHub](https://github.com/silentmatt/expr-eval)
- [json-rules-engine GitHub](https://github.com/CacheControl/json-rules-engine)
- [quickjs-emscripten GitHub](https://github.com/justjake/quickjs-emscripten)

---

## 📝 待办事项

### 评审阶段
- [ ] 技术方案评审
- [ ] 工期和资源确认
- [ ] 安全性评审(特别是JS模式)
- [ ] UI交互设计评审

### 开发阶段(如果方案通过)
- [ ] Phase 1: 核心引擎 MVP (3天)
- [ ] Phase 2: 完整能力库 (4天)
- [ ] Phase 3: UI配置界面 (5天)
- [ ] Phase 4: 优化与文档 (2天)

---

## 💬 反馈与问题

如有任何疑问或建议,请:
1. 查看文档中的具体章节
2. 联系技术负责人
3. 提交 Issue 到项目仓库

---

**文档版本**: v1.0
**最后更新**: 2025-12-08
**维护者**: [待填写]
