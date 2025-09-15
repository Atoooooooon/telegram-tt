# 客服模块需求规格书与实现方案

## 1. 需求概述

### 1.1 功能描述
创建一个客服模块，能够将多个指定的群组或聊天整合到一个统一的对话窗口中。客服人员可以在一个界面中：
- 同时监听多个群组的新消息
- 查看来自不同群组的消息流
- 针对任意消息进行回复，回复将自动发送到对应的原始群组中

### 1.2 MVP 范围
- 支持监听预设的群组列表（群组ID写死在代码中）
- 统一消息展示界面
- 基础的消息回复功能
- 消息来源识别（显示消息来自哪个群组）

## 2. 技术架构设计

### 2.1 核心组件结构

```
src/components/customerService/
├── CustomerServicePanel.tsx          # 主面板组件
├── CustomerServicePanel.module.scss  # 样式文件
├── MessageWithSource.tsx             # 带来源信息的消息组件
├── MessageWithSource.module.scss     # 消息样式
├── ReplyComposer.tsx                 # 回复输入框组件
├── ReplyComposer.module.scss         # 回复框样式
├── GroupSelector.tsx                 # 群组选择器（可选）
└── hooks/
    ├── useCustomerServiceMessages.ts # 消息聚合钩子
    └── useCustomerServiceActions.ts  # 客服操作钩子
```

### 2.2 全局状态扩展

```typescript
// src/global/types/index.ts 扩展
interface TabState {
  // ... 现有状态
  customerService?: {
    isActive: boolean;
    monitoredChats: string[];
    aggregatedMessages: ApiMessage[];
    selectedMessageForReply?: string;
  };
}
```

### 2.3 Actions 扩展

```typescript
// src/global/actions/ui/customerService.ts
- toggleCustomerService
- addMonitoredChat
- removeMonitoredChat
- selectMessageForReply
- sendCustomerServiceReply
- loadCustomerServiceHistory
```

## 3. 详细实现方案

### 3.1 消息聚合机制

#### 3.1.1 监听机制
利用现有的消息更新机制（`apiUpdaters/messages.ts`），扩展更新逻辑：

```typescript
// 在现有消息更新处理中添加客服模块逻辑
if (isCustomerServiceActive && isMonitoredChat(chatId)) {
  dispatch('addToCustomerServiceFeed', { message, chatId });
}
```

#### 3.1.2 消息数据结构
扩展消息对象，添加来源信息：

```typescript
interface CustomerServiceMessage extends ApiMessage {
  sourceChat: {
    id: string;
    title: string;
    type: ApiChatType;
  };
  isCustomerServiceMessage: true;
}
```

### 3.2 UI 组件实现

#### 3.2.1 主面板组件 (CustomerServicePanel.tsx)

```typescript
const CustomerServicePanel = () => {
  const customerServiceState = useSelector(selectCustomerServiceState);
  const messages = useCustomerServiceMessages();
  
  return (
    <div className={styles.customerServicePanel}>
      <div className={styles.header}>
        <h2>{lang('CustomerService')}</h2>
        <span className={styles.monitoredCount}>
          {lang('MonitoringChats', { count: monitoredChats.length })}
        </span>
      </div>
      
      <div className={styles.messageList}>
        {messages.map((message) => (
          <MessageWithSource
            key={`${message.sourceChat.id}-${message.id}`}
            message={message}
            onReply={handleReply}
          />
        ))}
      </div>
      
      {selectedMessage && (
        <ReplyComposer
          originalMessage={selectedMessage}
          onSend={handleSendReply}
          onCancel={handleCancelReply}
        />
      )}
    </div>
  );
};
```

#### 3.2.2 带来源的消息组件 (MessageWithSource.tsx)

```typescript
const MessageWithSource = ({ message, onReply }: Props) => {
  return (
    <div className={styles.messageWithSource}>
      <div className={styles.sourceInfo}>
        <Avatar size="tiny" chat={message.sourceChat} />
        <span className={styles.chatTitle}>{message.sourceChat.title}</span>
        <span className={styles.timestamp}>
          {formatTime(message.date)}
        </span>
      </div>
      
      <div className={styles.messageContent}>
        <Message message={message} />
        <button 
          className={styles.replyButton}
          onClick={() => onReply(message)}
        >
          {lang('Reply')}
        </button>
      </div>
    </div>
  );
};
```

### 3.3 回复机制实现

#### 3.3.1 回复发送逻辑

```typescript
// src/global/actions/api/customerService.ts
export const sendCustomerServiceReply = async (
  global: GlobalState,
  actions: RequiredGlobalActions,
  {
    originalMessage,
    replyText,
    attachments = [],
  }: {
    originalMessage: CustomerServiceMessage;
    replyText: string;
    attachments?: ApiAttachment[];
  }
) => {
  const { sourceChat } = originalMessage;
  
  // 使用现有的 sendMessage action，但指定目标聊天
  const result = await callApi('sendMessage', {
    chatId: sourceChat.id,
    text: replyText,
    replyToMessageId: originalMessage.id,
    attachments,
  });
  
  if (result) {
    actions.showNotification({
      message: lang('CustomerServiceReplySent', { 
        chat: sourceChat.title 
      })
    });
  }
};
```

### 3.4 配置管理

#### 3.4.1 监听的群组配置

```typescript
// src/config/customerService.ts
export const CUSTOMER_SERVICE_CONFIG = {
  MONITORED_CHATS: [
    '-1001234567890', // 技术支持群
    '-1001234567891', // 产品反馈群
    '-1001234567892', // 用户咨询群
  ],
  MAX_MESSAGES_DISPLAY: 100,
  AUTO_REFRESH_INTERVAL: 5000, // 5秒
};
```

## 4. 集成方案

### 4.1 路由集成
在现有的路由结构中添加客服面板：

```typescript
// 在 MiddleColumn.tsx 中添加客服模式
if (customerServiceMode) {
  return <CustomerServicePanel />;
}
```

### 4.2 导航集成
在左侧面板添加客服模块入口：

```typescript
// 在 LeftColumn.tsx 中添加
<MenuItem
  icon="customer-service"
  onClick={() => actions.toggleCustomerService()}
>
  {lang('CustomerService')}
</MenuItem>
```

### 4.3 权限控制
添加客服权限检查：

```typescript
const canAccessCustomerService = useSelector(selectCanAccessCustomerService);

// 基于用户角色或权限控制客服功能的显示
```

## 5. 数据流设计

### 5.1 消息流向
1. **接收**: 群组消息 → API更新 → 客服消息聚合器 → UI展示
2. **发送**: 客服回复 → API发送 → 目标群组 → 确认反馈

### 5.2 状态管理
```typescript
// 客服状态流转
INACTIVE → LOADING → ACTIVE → REPLYING → ACTIVE
```

## 6. 样式设计要点

### 6.1 布局原则
- 使用现有的消息列表样式作为基础
- 添加来源标识的视觉区分
- 保持与主界面的一致性

### 6.2 响应式设计
- 在小屏设备上可能需要分页或折叠显示
- 回复框应支持展开/收起

## 7. 性能考虑

### 7.1 消息数量限制
- 限制内存中保存的消息数量
- 实现消息分页加载
- 定期清理过期消息

### 7.2 实时更新优化
- 使用现有的长轮询机制
- 避免重复渲染
- 消息去重处理

## 8. 未来扩展方向

### 8.1 增强功能
- 消息搜索和过滤
- 快捷回复模板
- 消息标记和分类
- 统计报表功能

### 8.2 UI 优化
- 群组颜色标识
- 消息优先级显示
- 批量操作功能

## 9. 开发里程碑

### 9.1 Phase 1 (MVP)
- [ ] 基础组件开发
- [ ] 消息聚合功能
- [ ] 简单回复功能

### 9.2 Phase 2 (优化)
- [ ] UI/UX 优化
- [ ] 性能优化
- [ ] 错误处理完善

### 9.3 Phase 3 (扩展)
- [ ] 高级功能开发
- [ ] 权限系统
- [ ] 数据持久化

## 10. 技术注意事项

1. **遵循现有代码规范**: 使用项目的 TypeScript、SCSS 和组件模式
2. **状态管理**: 利用现有的 withGlobal 和 selector 机制
3. **国际化**: 所有文本使用 lang() 函数
4. **性能**: 合理使用 memo() 和 useCallback
5. **错误处理**: 集成现有的错误处理机制

此方案充分利用了现有的 Telegram Web 应用架构，最小化了对现有代码的侵入性，同时保持了良好的可扩展性。