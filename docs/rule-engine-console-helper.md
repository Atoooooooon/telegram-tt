# 规则引擎 - 浏览器控制台添加规则

在还没有UI配置界面的情况下，通过浏览器控制台手动添加规则。

---

## 🚀 快速添加规则

### 方法1: 一键添加示例规则

打开浏览器控制台（F12），复制���贴以下代码：

```javascript
// ============================================
// 示例1: 检测到"foo"自动回复"bar"
// ============================================
(function() {
  // 获取当前设置
  const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');

  // 确保规则数组存在
  if (!settings.rules) {
    settings.rules = [];
  }

  // 启用规则引擎
  settings.ruleEngineConfig = {
    enabled: true,
    fallbackToLegacy: true,
    maxExecutionTime: 5000,
  };

  // 添加规则
  settings.rules.push({
    id: 'auto_reply_foo_bar',
    name: '检测foo自动回复bar',
    enabled: true,
    priority: 5,
    trigger: {
      eventType: 'customer_message',
    },
    pipeline: [
      {
        id: 'check_foo',
        capabilityId: 'check_text_match',
        config: {
          pattern: 'foo',
          mode: '包含',
        },
        onSuccess: { continueNext: true },
        onFailure: { stopPipeline: true },
      },
      {
        id: 'reply_bar',
        capabilityId: 'action_auto_reply',
        config: {
          template: 'bar',
          replyToOriginal: true,
        },
      },
    ],
  });

  // 保存到 localStorage
  localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));

  console.log('✅ 规则添加成功！');
  console.log('📋 当前规则列表:', settings.rules.map(r => `${r.id}: ${r.name}`));
  console.log('🔄 请刷新页面使规则生效');
})();
```

执行后应该看到：
```
✅ 规则添加成功！
📋 当前规则列表: ['auto_reply_foo_bar: 检测foo自动回复bar']
🔄 请刷新页面使规则生效
```

**然后刷新页面**，规则就生效了！

---

## 🛠️ 方法2: 手动编辑完整配置

如果你想一次性配置多条规则：

```javascript
// 获取当前设置
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');

// 完整配置
settings.ruleEngineConfig = {
  enabled: true,
  fallbackToLegacy: true,
  maxExecutionTime: 5000,
};

settings.rules = [
  // 规则1: 检测foo回复bar
  {
    id: 'auto_reply_foo_bar',
    name: '检测foo自动回复bar',
    enabled: true,
    priority: 5,
    trigger: {
      eventType: 'customer_message',
    },
    pipeline: [
      {
        id: 'check_foo',
        capabilityId: 'check_text_match',
        config: { pattern: 'foo', mode: '包含' },
        onSuccess: { continueNext: true },
        onFailure: { stopPipeline: true },
      },
      {
        id: 'reply_bar',
        capabilityId: 'action_auto_reply',
        config: { template: 'bar', replyToOriginal: true },
      },
    ],
  },

  // 规则2: AI说"已解决"自动标记已读
  {
    id: 'ai_auto_mark_read',
    name: 'AI解决问题自动标记',
    enabled: true,
    priority: 10,
    trigger: {
      eventType: 'bot_reply',
      senderIds: ['YOUR_BOT_ID'],  // ⚠️ 替换成你的机器人ID
    },
    pipeline: [
      {
        id: 'check_resolved',
        capabilityId: 'check_text_match',
        config: { pattern: '已解决|已处理', mode: '包含' },
        onSuccess: { continueNext: true },
        onFailure: { stopPipeline: true },
      },
      {
        id: 'mark_read',
        capabilityId: 'action_mark_read',
        config: { targetMessage: '回复的原消息' },
      },
    ],
  },

  // 规则3: 关键词自动回复
  {
    id: 'faq_auto_reply',
    name: '常见问题自动回复',
    enabled: true,
    priority: 3,
    trigger: {
      eventType: 'customer_message',
    },
    pipeline: [
      {
        id: 'check_keyword',
        capabilityId: 'check_text_match',
        config: { pattern: '营业时间|几点开门|工作时间', mode: '正则' },
        onFailure: { stopPipeline: true },
      },
      {
        id: 'reply_hours',
        capabilityId: 'action_auto_reply',
        config: {
          template: '我们的营业时间是每天 9:00-18:00，欢迎咨询！',
          replyToOriginal: true
        },
      },
    ],
  },
];

// 保存
localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
console.log('✅ 配置已保存，共', settings.rules.length, '条规则');
console.log('🔄 请刷新页面');
```

---

## 📋 查看当前规则

```javascript
// 查看所有规则
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
console.table(
  (settings.rules || []).map(r => ({
    ID: r.id,
    名称: r.name,
    启用: r.enabled ? '✅' : '❌',
    优先级: r.priority,
    触发类型: r.trigger.eventType,
  }))
);
```

---

## 🗑️ 删除规则

```javascript
// 删除指定ID的规则
function deleteRule(ruleId) {
  const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
  if (!settings.rules) return;

  const before = settings.rules.length;
  settings.rules = settings.rules.filter(r => r.id !== ruleId);
  const after = settings.rules.length;

  localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
  console.log(`✅ 删除了 ${before - after} 条规则`);
  console.log('🔄 请刷新页面');
}

// 使用示例
deleteRule('auto_reply_foo_bar');
```

---

## 🔄 启用/禁用规则

```javascript
// 禁用指定规则
function toggleRule(ruleId, enabled) {
  const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
  const rule = (settings.rules || []).find(r => r.id === ruleId);

  if (!rule) {
    console.error('❌ 规则不存在:', ruleId);
    return;
  }

  rule.enabled = enabled;
  localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
  console.log(`✅ 规则 ${ruleId} 已${enabled ? '启用' : '禁用'}`);
  console.log('🔄 请刷新页面');
}

// 使用示例
toggleRule('auto_reply_foo_bar', false);  // 禁用
toggleRule('auto_reply_foo_bar', true);   // 启用
```

---

## 🔧 修改规则

```javascript
// 修改规则配置
function updateRule(ruleId, updates) {
  const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
  const rule = (settings.rules || []).find(r => r.id === ruleId);

  if (!rule) {
    console.error('❌ 规则不存在:', ruleId);
    return;
  }

  Object.assign(rule, updates);
  localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
  console.log('✅ 规则已更新');
  console.log('🔄 请刷新页面');
}

// 使用示例：修改回复内容
updateRule('auto_reply_foo_bar', {
  pipeline: [
    {
      id: 'check_foo',
      capabilityId: 'check_text_match',
      config: { pattern: 'foo', mode: '包含' },
      onSuccess: { continueNext: true },
      onFailure: { stopPipeline: true },
    },
    {
      id: 'reply_bar',
      capabilityId: 'action_auto_reply',
      config: {
        template: '新的回复内容：bar bar bar！',  // 修改这里
        replyToOriginal: true
      },
    },
  ],
});
```

---

## 🧹 清空所有规则

```javascript
// ⚠️ 危险操作：清空所有规则
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
settings.rules = [];
localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
console.log('✅ 所有规则已清空');
console.log('🔄 请刷新页面');
```

---

## 📤 导出/导入规则

### 导出规则
```javascript
// 导出为JSON文件
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
const dataStr = JSON.stringify(settings.rules, null, 2);
const blob = new Blob([dataStr], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'my-rules.json';
a.click();
console.log('✅ 规则已导出');
```

### 导入规则
```javascript
// 从JSON导入（先手动复制JSON内容）
const importedRules = [
  // 粘贴你的规则JSON
];

const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
settings.rules = importedRules;
localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
console.log('✅ 导入成功，共', importedRules.length, '条规则');
console.log('🔄 请刷新页面');
```

---

## 🐛 调试

### 查看规则引擎配置
```javascript
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
console.log('规则引擎配置:', settings.ruleEngineConfig);
console.log('规则总数:', (settings.rules || []).length);
console.log('已启用规则:', (settings.rules || []).filter(r => r.enabled).length);
```

### 重置规则引擎
```javascript
const settings = JSON.parse(localStorage.getItem('customerServiceV2Settings') || '{}');
delete settings.rules;
delete settings.ruleEngineConfig;
localStorage.setItem('customerServiceV2Settings', JSON.stringify(settings));
console.log('✅ 规则引擎已重置');
console.log('🔄 请刷新页面');
```

---

**注意**：每次修改后都需要**刷新页面**才能生效！
