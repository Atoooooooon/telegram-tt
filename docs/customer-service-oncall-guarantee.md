# 客服 OnCall 保障方案

> **版本**: v1.0
> **最后更新**: 2026-03-31
> **状态**: 草案

---

## 1. 背景与问题定义

当前项目中的客服能力定位已经比较明确:

- Web 端主要挂后台运行
- 目标是自动已读和过滤废物消息,减轻其他端的噪音
- 现有 `filteredUserIds`、`regexFilters` 和规则引擎前置逻辑满足当前过滤需求

因此,本方案**不讨论过滤精度优化**,也**不试图推翻现有自动已读策略**。

当前真正的问题是:

> 在完成过滤之后,剩下的“有用消息”仍然可能因为人工遗漏而没有被处理。

这说明系统目前已经具备“降噪能力”,但还缺少“处理保障能力”。

---

## 2. 目标与非目标

### 2.1 目标

为所有进入客服队列的消息建立可追踪、可升级、可回查的处理闭环,确保它们满足以下约束:

1. 每条进入客服队列的消息都必须进入一个明确的处理状态
2. 每条待处理事项都必须能追踪到负责人或轮值人
3. 在约定 SLA 时间内,要么有人确认处理,要么系统自动升级
4. 同一会话后续出现新信息时,能够重新激活处理流程

### 2.2 非目标

以下内容不在本阶段范围内:

1. 重新设计正则过滤或被过滤消息的自动已读逻辑
2. 将 Web 端改造成主要人工坐席工作台
3. 让 AI 决定消息是否需要处理
4. 一次性重做全部客服数据结构和 UI

---

## 3. 核心设计原则

### 3.1 Web 端是“保障器”,不是“收件箱”

当前 Web 端的核心职责不是给人浏览所有消息,而是为进入客服队列的消息提供漏单保护。

设计重点应该从“消息列表”转向“处理闭环”。

同时,真正承担“可靠升级和通知”的组件不应继续停留在浏览器后台页,而应迁移到常驻的 Node 服务。

### 3.2 从 Message Queue 升级为 Case Queue

仅有消息进入队列还不够,因为:

- 队列中的消息可能没人接
- 同一 chat 的多条消息会分散注意力
- 无法自然表达“处理中 / 已确认 / 已解决 / 重新打开”

因此,应该将“进入客服队列的消息”聚合为“待处理事项(case)”。

### 3.3 保障逻辑必须显式建模

一条消息只要进入客服队列,就不应该停留在“存在于列表里”这个模糊状态,而应具备:

- 状态
- 负责人
- 超时规则
- 升级规则
- 重开规则

### 3.4 AI 只做提效,不做兜底判决

AI 可以参与:

- 摘要生成
- 优先级建议
- 关键信息提取
- 推荐处理模板

但不应单独决定“是否需要处理”,避免把保障链路建立在不稳定判断上。

---

## 4. 目标闭环

每条进入客服队列的消息都必须满足下列路径之一:

1. 进入新 case
2. 合并到已有 active case
3. 触发已有 case 的重开或升级

随后系统持续检查:

1. 是否有人 `ack`
2. 是否有人认领 `owner`
3. 是否超时未处理
4. 是否需要升级通知

最终保证:

> 任何一条进入客服队列的消息,在约定时间内,要么有人确认接手,要么系统自动升级。

---

## 5. 总体架构建议

建议将当前方案拆为两个协作层:

### 5.1 Web 端职责

Web 端继续负责:

1. 监听 Telegram 消息
2. 执行现有过滤逻辑
3. 将进入客服队列的消息上报给保障层
4. 可选地同步工作人员动作,例如 `ack`、`resolve`

### 5.2 Node 服务职责

Node 服务新增并长期承担:

1. case 聚合与持久化
2. 工作人员回复分类
3. 升级 deadline 计算
4. 单次延迟触发与重置
5. 最高级别通知
6. 机器人向指定群发提醒消息
7. OCR 代理等外部能力整合

当前第一版实现采用内存态 case store:

- 不做本地文件持久化
- 进程重启后 case 与 deadline 允许丢失
- 先优先验证升级链路与 Bot 告警是否有效
- 后续如需增强,再替换为 Redis

### 5.3 设计原则

Web 端负责“识别并上报进入客服队列的消息”。

Node 服务负责“保证这些消息最终被处理或被升级”。

---

## 6. 数据模型建议

本阶段建议保留现有 `customerServiceV2.messages` 能力,在其基础上新增 case 视图。

### 6.1 Case 核心结构

```ts
type CustomerServiceCaseStatus =
  | 'new'
  | 'acked'
  | 'processing'
  | 'resolved'
  | 'reopened'
  | 'expired';

type CustomerServiceCasePriority =
  | 'low'
  | 'normal'
  | 'high'
  | 'urgent';

type CustomerServiceCase = {
  id: string;
  chatId: string;
  status: CustomerServiceCaseStatus;
  priority: CustomerServiceCasePriority;
  ownerUserId?: string;
  messageIds: number[];
  firstMessageId: number;
  lastMessageId: number;
  createdAt: number;
  updatedAt: number;
  lastCustomerMessageAt: number;
  ackedAt?: number;
  processingAt?: number;
  resolvedAt?: number;
  reopenedAt?: number;
  escalationLevel: number;
  tags?: string[];
  summary?: string;
};
```

### 6.2 Case 运行时字段建议

为了支持事件驱动升级,建议在持久层增加以下字段:

```ts
type CustomerServiceCaseRuntime = {
  lastStaffReplyAt?: number;
  lastHoldingReplyAt?: number;
  lastEffectiveResponderId?: string;
  nextEscalateAt?: number;
  deadlineVersion: number;
  lastAlertAt?: number;
  highestAlertSentAt?: number;
};
```

说明:

- `lastStaffReplyAt`
  - 任意工作人员有效回复时间
- `lastHoldingReplyAt`
  - 工作人员回复“稍等 / 我看下 / 处理中”等承诺型话术的时间
- `lastEffectiveResponderId`
  - 最近一次有效接单或回复的工作人员
- `nextEscalateAt`
  - 当前 case 的下一次升级触发时间点
- `deadlineVersion`
  - 每次重算 deadline 时递增,用于废弃旧 timer
- `highestAlertSentAt`
  - 最高级别告警发送时间,避免重复刷群

### 6.3 CustomerServiceV2State 扩展建议

```ts
type CustomerServiceV2State = {
  messages: ApiMessage[];
  messagesByChatId: Record<string, ApiMessage[]>;

  casesById?: Record<string, CustomerServiceCase>;
  caseIdByChatId?: Record<string, string>;
  activeCaseIds?: string[];

  settings?: CustomerServiceSettings;
  lastSyncTimestamp: number;
  messageCount: number;
};
```

### 6.4 最小落地字段

如果希望先低成本验证,第一阶段最少增加这些字段即可:

- `casesById`
- `caseIdByChatId`
- `status`
- `ownerUserId`
- `ackedAt`
- `escalationLevel`
- `nextEscalateAt`
- `deadlineVersion`

---

## 7. 状态机设计

### 7.1 基础状态

| 状态 | 含义 | 是否需要值班关注 |
|------|------|------------------|
| `new` | 新进入,无人确认 | 是 |
| `acked` | 已有人确认看到 | 是 |
| `processing` | 已进入处理中 | 是 |
| `resolved` | 已处理完成 | 否 |
| `reopened` | 已解决后因新消息重新激活 | 是 |
| `expired` | 超时未处理,等待补偿或归档 | 是 |

### 7.2 关键流转

```text
new -> acked -> processing -> resolved
new -> expired
acked -> expired
processing -> expired
resolved -> reopened
reopened -> acked / processing
```

### 7.3 状态流转规则

1. 消息首次进入客服队列时:
   - 创建 case
   - 状态设为 `new`
   - 记录 `lastCustomerMessageAt`

2. 值班人员确认接手时:
   - 状态设为 `acked`
   - 写入 `ownerUserId`
   - 写入 `ackedAt`

3. 开始处理时:
   - 状态设为 `processing`
   - 写入 `processingAt`

4. 完成处理时:
   - 状态设为 `resolved`
   - 写入 `resolvedAt`

5. 同一 chat 后续再次出现有效新消息时:
   - 若仍有 active case,则合并消息
   - 若 case 已 `resolved`,则转为 `reopened`
   - 必要时提升 `priority`

6. 超时未处理时:
   - 提高 `escalationLevel`
   - 触发通知
   - 必要时标记为 `expired`

---

## 8. 保障机制

### 8.1 Case 聚合

默认按 `chatId` 聚合,即:

- 一个 chat 同一时段只保留一个 active case
- 新消息优先并入已有 case
- 不把每条消息都独立当成一个待办

这样可以减少队列膨胀,也更符合 oncall 的处理方式。

### 8.2 Ack 机制

当前最大的风险不是“看不到”,而是“看到了但没人明确接手”。

因此必须把“确认接手”从隐含行为变成显式动作。

建议新增动作:

- `ackCase(caseId, ownerUserId)`
- `startProcessing(caseId, ownerUserId)`
- `resolveCase(caseId, ownerUserId)`
- `reopenCase(caseId, reason)`

只要没有 `ack`,系统就默认这条事项仍然无人负责。

### 8.3 工作人员回复事件分类

升级逻辑的关键不是简单判断“有没有回复”,而是判断“回复属于哪一类”。

建议在保障层把工作人员行为建模为以下事件:

```ts
type StaffReplyKind =
  | 'holding_reply'
  | 'real_reply'
  | 'resolve_reply';
```

分类定义:

1. `holding_reply`
   - 例如: “稍等”“我看下”“处理中”“帮你确认下”
   - 语义: 有人接触到了问题,但还不能视为已处理
   - 作用: 延后升级,但不彻底关闭升级链路

2. `real_reply`
   - 例如: 已经开始和用户有效沟通,给出下一步动作或实际回答
   - 语义: 已有人接手
   - 作用: 取消当前“无人响应”升级

3. `resolve_reply`
   - 例如: 已明确处理完成
   - 语义: case 可进入 `resolved`
   - 作用: 停止升级链路

“其他工作人员已回复”不需要单独建模为一种特殊升级类型。

在系统语义上,它仍然属于 `real_reply`,关键是:

- 只要最新客户消息之后已经出现任意工作人员有效回复
- 就不应再因为“无人回复”而升级

### 8.4 事件模型

建议保障层只处理明确事件,而不是扫描所有 case 猜测状态。

推荐事件类型:

```ts
type CaseEvent =
  | { type: 'customer_message'; chatId: string; messageId: number; createdAt: number }
  | { type: 'staff_reply'; chatId: string; messageId: number; createdAt: number; staffUserId: string; kind: StaffReplyKind }
  | { type: 'ack'; caseId: string; userId: string; createdAt: number }
  | { type: 'resolve'; caseId: string; userId: string; createdAt: number }
  | { type: 'deadline_reached'; caseId: string; deadlineVersion: number; createdAt: number };
```

### 8.5 SLA 与升级规则

建议不要只配置一个统一超时,而是按事件类型区分:

建议在设置中增加 SLA 阈值:

```ts
type CustomerServiceSlaSettings = {
  firstResponseTimeoutMs: number;
  highestEscalationTimeoutMs: number;
  holdingReplyGraceTimeoutMs: number;
  reminderCooldownMs: number;
};
```

推荐默认值:

- `firstResponseTimeoutMs = 300_000`
- `highestEscalationTimeoutMs = 600_000`
- `holdingReplyGraceTimeoutMs = 900_000`
- `reminderCooldownMs = 300_000`

典型升级策略:

1. 客户新消息到来后:
   - 若无人回复,在 `firstResponseTimeoutMs` 时触发一级升级
   - 若仍无人回复,在 `highestEscalationTimeoutMs` 时触发最高级告警

2. 若工作人员回复 `holding_reply`:
   - 取消当前无人响应 deadline
   - 改为新的宽限 deadline
   - 若在 `holdingReplyGraceTimeoutMs` 内仍无 `real_reply`,继续升级

3. 若任意工作人员回复 `real_reply`:
   - 取消当前无人响应升级
   - case 进入 `acked` 或 `processing`

4. 若工作人员执行 `resolve` 或发送 `resolve_reply`:
   - 停止升级链路
   - case 进入 `resolved`

### 8.6 事件驱动升级引擎

本方案不以周期扫描为核心,而以“事件驱动 + 单次 deadline”作为主路径。

核心机制:

1. 某个 case 收到事件
2. Node 服务更新 case 状态
3. 重新计算 `nextEscalateAt`
4. `deadlineVersion += 1`
5. 注册一个新的单次延迟任务
6. 旧任务即使稍后触发,也会因为版本不匹配而自动失效

伪代码:

```ts
onCaseEvent(event) {
  const caseRecord = applyEvent(event);
  const nextEscalateAt = computeNextDeadline(caseRecord);
  caseRecord.deadlineVersion += 1;
  caseRecord.nextEscalateAt = nextEscalateAt;
  save(caseRecord);

  if (nextEscalateAt) {
    scheduleOnce(caseRecord.id, caseRecord.deadlineVersion, nextEscalateAt);
  }
}

onDeadlineReached(caseId, deadlineVersion) {
  const caseRecord = load(caseId);
  if (caseRecord.deadlineVersion !== deadlineVersion) return;
  if (!shouldEscalate(caseRecord)) return;

  escalate(caseRecord);
  recalculateAndReschedule(caseRecord);
}
```

优势:

- 比周期扫描更及时
- 更贴合“稍等后再延时”的业务语义
- 不会因为一个全局扫描周期导致升级抖动
- 更容易做幂等控制

### 8.7 Node 服务与恢复机制

Node 服务建议长期运行,以保证 deadline 和告警链路稳定。

当前第一版接受如下约束:

1. case 仅保存在内存中
2. Node 服务重启后,未完成 case 会丢失
3. 旧 timer 不做恢复

这是刻意的阶段性取舍,原因是:

- 当前重点是先跑通升级逻辑
- 用户明确接受“重启丢失没关系”
- 后续若需要再切换为 Redis,比先做文件落盘更自然

### 8.8 升级与通知

通知链路应该独立于 Web 当前展示状态。

推荐支持以下通知目标:

- 指定值班 Telegram 群
- 指定值班人私聊
- 内部 Webhook
- 飞书 / 企业微信 / 钉钉桥接

第一阶段建议只启用最关键的一条:

1. case 升级到最高级别时
2. Telegram Bot 向指定群发送提醒消息

Bot 消息建议包含:

- `caseId`
- 来源 `chatId` 或聊天标题
- 当前升级等级
- 最新客户消息摘要
- 最后一次工作人员响应状态
- 是否曾出现“稍等”但后续无有效回复
- 可跳转或可检索的定位信息

告警去重建议:

1. 同一个 case 首次达到最高级别时发送一次
2. 在冷却时间内不重复刷群
3. 只有状态变化或再次重开时才允许补发

### 8.9 Reopen 机制

以下情况建议触发重开或升优先级:

1. 同一 chat 在 `resolved` 后又收到新消息
2. 用户追加了图片、视频、订单号、截图等关键信息
3. 用户再次催促
4. 规则引擎识别到风险词或投诉词

`reopen` 的本质是:

> 不把“解决过”误当成“未来不会再出问题”。

---

## 9. 与现有实现的结合方式

### 9.1 保持现有过滤入口不变

当前逻辑中,消息在 `apiUpdaters/messages.ts` 中完成:

1. 监听
2. 前置规则
3. 基础过滤
4. 后置规则
5. 入客服队列

本方案建议:

- 保留这条链路
- 在“入队”之后补充 case 创建 / 合并 / 重开逻辑
- 不立即修改现有 regex 和 auto-read 行为

### 9.2 引入 Node 服务后的数据流

建议数据流调整为:

1. Web 端识别到“进入客服队列的消息”
2. Web 端调用 Node 服务 `ingestUsefulMessage`
3. Node 服务按 `chatId` 创建或更新 case
4. Node 服务根据事件重算升级 deadline
5. 到达最高级别时由 Bot 发群通知

工作人员操作也建议上报到 Node 服务:

1. `reportStaffReply`
2. `ackCase`
3. `resolveCase`

### 9.3 与现有 `messages` 队列共存

第一阶段不建议删除现有 `messages` 平铺数组。

更稳妥的方式是:

1. `messages` 继续作为原始事件缓存
2. `casesById` 作为保障层视图
3. UI 可以先继续显示消息,后续再补 case 视图

### 9.4 与现有规则引擎的分工

规则引擎仍然负责:

- 识别消息特征
- 提取信息
- 进行优先级标记
- 执行自动动作

保障层额外负责:

- 是否创建或重开 case
- 是否升级
- 是否已经 ack
- 是否超时

不要让规则引擎独自承担“闭环保障”职责。

---

## 10. 分阶段落地建议

### Phase 1: 最小闭环

目标:

- 引入 Node 服务中的 case 数据结构
- 让每个有用 chat 至少有一个 active case
- 能识别“无人回复 / 稍等 / 已有效回复”

实现内容:

1. 在 Node 服务中增加 case 持久化
2. Web 端上报 `customer_message`
3. Node 服务按 `chatId` 创建或合并 case
4. 增加工作人员回复分类接口:
   - `holding_reply`
   - `real_reply`
   - `resolve_reply`

验收标准:

- 任一进入客服队列的消息,都能在系统中对应到一个 case
- 任一 case 都能判断“是否存在有效工作人员回复”

### Phase 2: 事件驱动升级

目标:

- 不依赖人工主动盯列表
- 不依赖全局周期扫描

实现内容:

1. 新增 deadline 计算与 `deadlineVersion`
2. 事件到达后注册单次延迟任务
3. deadline 触发后执行升级
4. 记录 `escalationLevel` 与 `nextEscalateAt`

验收标准:

- 超时 case 会在接近 deadline 的时刻被自动升级
- 旧 deadline 不会误触发新状态的 case

### Phase 3: Bot 群通知

目标:

- 让最高级别 case 能直接提醒其他端

实现内容:

1. 接入 Telegram Bot
2. 配置指定通知群
3. 当 case 达到最高级别时发送群消息
4. 增加冷却与去重

验收标准:

- 最高级别 case 能稳定在指定群收到提醒
- 同一 case 不会在短时间内重复刷屏

### Phase 4: Reopen + Priority

目标:

- 让同一 chat 的后续变化能重新进入闭环

实现内容:

1. 新消息到达时判断 active / resolved case
2. 满足条件时重开 case
3. 按规则或启发式调整优先级
4. 支持 `high / urgent`

验收标准:

- 已解决 chat 再次发来关键新消息时,case 能被重开
- 高风险 case 能进入更强提醒链路

### Phase 5: AI 提效增强

目标:

- 降低人工理解成本,但不改变保障底线

实现内容:

1. 自动摘要
2. 关键信息提取
3. 优先级建议
4. 处理建议模板

验收标准:

- AI 失败不影响 case 创建、ack、升级、重开等基础能力

---

## 11. 指标与验收

建议增加以下指标:

### 10.1 核心保障指标

1. `case_ack_rate_5m`
   - 5 分钟内被 ack 的 case 比例

2. `case_escalation_rate`
   - 触发升级的 case 比例

3. `reopened_case_rate`
   - 已解决后重开的 case 比例

4. `unowned_case_count`
   - 当前无 owner 的 active case 数量

### 10.2 提效指标

1. 平均 ack 时间
2. 平均解决时间
3. 每位值班人当前 active case 数
4. 自动摘要命中率

### 10.3 合格标准

从业务角度,方案是否有效可以简化为一句话:

> 任意一条进入客服队列的消息,在 N 分钟内,要么被明确接手,要么被系统自动升级。

---

## 12. 风险与控制

### 11.1 风险: 过度提醒

若升级策略过于激进,会把噪音从用户消息转移到内部告警。

缓解方式:

- 设置升级冷却时间
- 每个 case 限制单位时间提醒次数
- 区分 `normal` 和 `urgent`

### 12.2 风险: 旧 deadline 误触发

事件驱动模型下,若不做版本控制,旧的延迟任务可能在状态已变化后错误触发。

缓解方式:

- 引入 `deadlineVersion`
- deadline 触发时强制比对版本
- 所有升级逻辑以数据库当前状态为准

### 12.3 风险: Node 服务重启导致告警丢失

当前阶段接受该风险。

若后续需要缓解,优先方案是:

- 引入 Redis 持久化 `nextEscalateAt`
- 服务启动时恢复未完成 deadline
- 对已超时未触发 case 做一次补偿判断

### 12.4 风险: 状态过重,影响现有逻辑

如果第一阶段同时改消息列表、规则引擎、通知链路,回归风险很高。

缓解方式:

- 先加 case 数据层
- 保留现有 messages 队列
- 分阶段启用 Node 服务、升级链路和 UI

### 12.5 风险: owner 信息不可靠

如果 owner 只靠“谁点开了聊天”推断,最终仍会回到隐式处理。

缓解方式:

- owner 必须来自显式 ack 动作
- 打开聊天不等于接单

---

## 13. 推荐的第一步

如果只做一个最小改动,优先顺序建议如下:

1. 引入 Node 服务中的 `case` 模型
2. 打通 Web 端上报“进入客服队列消息”接口
3. 实现事件驱动 deadline
4. 最高级别时由 Bot 发群提醒

原因:

- 这四项已经能形成最小处理闭环
- 能直接覆盖“未回复 / 稍等 / 已有人回复 / 最高级别提醒”这几个核心场景
- 不要求推翻现有过滤逻辑
- 最快能验证是否真的减少人工遗漏

---

## 14. 后续实现建议

建议后续实现时优先修改以下模块:

- `src/global/types/customerServiceV2.ts`
  - 增加 case 类型与状态定义

- `src/global/actions/ui/customerServiceV2Messages.ts`
  - 在消息入队时创建或合并 case

- `src/global/selectors/customerServiceV2.ts`
  - 增加 case 查询能力

- `src/global/actions/ui/customerServiceV2.ts`
  - 增加 `ackCase`、`resolveCase`、`reopenCase`

- `server/index.mjs`
  - 扩展 Node 服务入口与路由注册

- `server/routes/*`
  - 增加 case ingest / reply report / ack / resolve / bot alert 路由

- `server/lib/*`
  - 增加 case store、deadline scheduler、telegram bot client

- `src/global/intervals.ts`
  - 不再作为主升级机制,仅保留必要的前端补偿或同步逻辑

---

## 15. 总结

当前系统已经解决了“噪音太多”的问题,下一阶段应解决“进入客服队列的消息没人接住”的问题。

本方案的核心不是继续优化过滤器,而是为进入客服队列的消息补上以下能力:

1. 显式状态
2. 显式负责人
3. 事件驱动升级
4. “稍等 / 有效回复 / 已解决”分类
5. Telegram Bot 最高级别群提醒
6. 重开机制

最终目标不是“消息进队列”,而是“消息进入处理闭环”。
