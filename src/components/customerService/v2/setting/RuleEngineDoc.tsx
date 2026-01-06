import type { FC } from '../../../../lib/teact/teact';
import { memo } from '../../../../lib/teact/teact';

import Icon from '../../../common/icons/Icon';

import styles from './tabs/RuleEngineTab.module.scss';

/**
 * Rule Engine Documentation Component
 * This component displays the documentation for configuring rules
 * Separated for easier maintenance and future localization
 */
const RuleEngineDoc: FC = () => {
  return (
    <div className={styles.ruleEditDocs}>
      <h4 className={styles.ruleEditDocsTitle}>
        <Icon name="document" />
        规则配置参数
      </h4>
      <div className={styles.ruleEditDocsContent}>
        <section className={styles.docSection}>
          <h5>基础字段</h5>
          <ul>
            <li>
              <code>id</code>
              : 规则唯一标识符 (string, 必填)
              <br />
              <strong>重要:</strong>
              {' '}
              复制规则时务必修改 ID，否则会导致编辑冲突。系统会自动检测重复 ID 并提示错误。
            </li>
            <li>
              <code>name</code>
              : 规则显示名称 (string, 必填)
            </li>
            <li>
              <code>enabled</code>
              : 是否启用 (boolean, 必填)
            </li>
            <li>
              <code>executionPhase</code>
              : 执行阶段 (string, 可选)
              <ul>
                <li>
                  <code>pre-filter</code>
                  {' '}
                  - 前置规则(在过滤前执行,可处理未监听群组的消息)
                </li>
                <li>
                  <code>post-filter</code>
                  {' '}
                  - 后置规则(在过滤后执行,默认值)
                </li>
              </ul>
            </li>
            <li>
              <code>skipPostProcessing</code>
              : 跳过后续所有处理 (boolean, 可选)
              <br />
              设为 true 时,规则执行完成后将跳过所有后续处理(包括过滤和后置规则)
            </li>
          </ul>
        </section>

        <section className={styles.docSection}>
          <h5>触发条件 (trigger)</h5>
          <ul>
            <li>
              <code>eventType</code>
              : 事件类型 (必填)
              <ul>
                <li>
                  <code>customer_message</code>
                  {' '}
                  - 客户消息
                </li>
                <li>
                  <code>bot_reply</code>
                  {' '}
                  - 机器人回复
                </li>
                <li>
                  <code>any_message</code>
                  {' '}
                  - 任意消息
                </li>
              </ul>
            </li>
            <li>
              <code>chatIds</code>
              : 限定聊天 ID (string[], 可选)
            </li>
            <li>
              <code>senderIds</code>
              : 限定发送者 ID (string[], 可选)
            </li>
          </ul>
        </section>

        <section className={styles.docSection}>
          <h5>执行管道 (pipeline)</h5>
          <p>每个步骤包含:</p>
          <ul>
            <li>
              <code>id</code>
              : 步骤 ID (string, 用于跳转定位)
            </li>
            <li>
              <code>capabilityId</code>
              : 能力 ID (string, 见下方详细列表)
            </li>
            <li>
              <code>config</code>
              : 配置对象 (object, 根据能力不同而不同)
            </li>
            <li>
              <code>onSuccess</code>
              : 成功时行为 (可选)
              <ul>
                <li>
                  <code>continueNext</code>
                  : 继续下一步 (boolean, 默认 true)
                </li>
                <li>
                  <code>gotoStep</code>
                  : 跳转到指定步骤 ID (string)
                </li>
                <li>
                  <code>executeAction</code>
                  : 执行额外动作能力 (string)
                </li>
              </ul>
            </li>
            <li>
              <code>onFailure</code>
              : 失败时行为 (可选)
              <ul>
                <li>
                  <code>stopPipeline</code>
                  : 停止执行 (boolean, 默认 false)
                </li>
                <li>
                  <code>gotoStep</code>
                  : 跳转到指定步骤 ID (string)
                </li>
                <li>
                  <code>executeAction</code>
                  : 执行额外动作能力 (string)
                </li>
              </ul>
            </li>
          </ul>
        </section>

        <section className={styles.docSection}>
          <h5>可用能力列表</h5>

          <div className={styles.capabilityItem}>
            <h6>
              <code>check_message</code>
              {' '}
              - 消息检测
            </h6>
            <p>检查消息内容和属性(文本/图片/视频/引用),可组合多种条件</p>
            <ul>
              <li>
                <code>textPattern</code>
                : 文本匹配模式 (string, 可选,提供后自动启用文本检查)
              </li>
              <li>
                <code>textMode</code>
                : 文本匹配方式 (string, 可选)
                <ul>
                  <li>
                    <code>包含</code>
                    {' '}
                    - 文本包含关键词 (默认)
                  </li>
                  <li>
                    <code>正则</code>
                    {' '}
                    - 正则表达式匹配
                  </li>
                  <li>
                    <code>完全相等</code>
                    {' '}
                    - 文本完全相同
                  </li>
                </ul>
              </li>
              <li>
                <code>checkHasPhoto</code>
                : 检查是否有图片 (boolean, 默认 false)
              </li>
              <li>
                <code>checkHasVideo</code>
                : 检查是否有视频 (boolean, 默认 false)
              </li>
              <li>
                <code>checkIsReply</code>
                : 检查是否有引用 (boolean, 默认 false)
              </li>
            </ul>
            <p>
              <strong>重要:</strong>
              {' '}
              所有启用的检查项都必须通过才会返回 success=true。
              例如提供 textPattern 且 checkHasPhoto=true 时,消息必须同时包含文本匹配和图片。
            </p>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>textMatched</code>
              ,
              {' '}
              <code>matchedText</code>
              ,
              {' '}
              <code>hasPhoto</code>
              ,
              {' '}
              <code>hasVideo</code>
              ,
              {' '}
              <code>isReply</code>
              ,
              {' '}
              <code>replyInfo</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>check_has_reply</code>
              {' '}
              - 回复检测
            </h6>
            <p>
              等待指定时长后检查消息是否被回复
              <strong>(非阻塞异步能力)</strong>
            </p>
            <ul>
              <li>
                <code>timeWindow</code>
                : 等待时长(秒) (number, 默认 300)
                <br />
                在后台等待这段时间后检查消息是否被回复
              </li>
            </ul>
            <p>
              <strong>路由控制:</strong>
              {' '}
              此能力支持完整的 onSuccess/onFailure 路由
            </p>
            <ul>
              <li>
                <strong>onSuccess</strong>
                : 检测到有回复时执行
                <ul>
                  <li>
                    <code>executeAction</code>
                    : 执行动作
                  </li>
                  <li>
                    <code>gotoStep</code>
                    : 跳转到指定步骤
                  </li>
                  <li>
                    <code>continueNext</code>
                    : 是否继续下一步 (默认 true)
                  </li>
                </ul>
              </li>
              <li>
                <strong>onFailure</strong>
                : 检测到无回复时执行
                <ul>
                  <li>
                    <code>executeAction</code>
                    : 执行动作
                  </li>
                  <li>
                    <code>gotoStep</code>
                    : 跳转到指定步骤
                  </li>
                  <li>
                    <code>stopPipeline</code>
                    : 是否停止流水线
                  </li>
                </ul>
              </li>
            </ul>
            <p>
              <strong>重要:</strong>
              {' '}
              此能力立即返回,在后台异步检查。同步引擎到此步骤会暂停,
              异步执行器会在时间到后继续执行后续步骤。
            </p>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>scheduled</code>
              ,
              {' '}
              <code>timeWindow</code>
              ,
              {' '}
              <code>messageId</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>action_mark_read</code>
              {' '}
              - 标记为已读
            </h6>
            <p>标记 Telegram 消息为已读</p>
            <ul>
              <li>
                <code>targetMessage</code>
                : 标记目标 (string, 默认 &quot;回复的原消息&quot;)
                <ul>
                  <li>
                    <code>当前消息</code>
                    {' '}
                    - 标记当前消息
                  </li>
                  <li>
                    <code>回复的原消息</code>
                    {' '}
                    - 标记被回复的消息
                  </li>
                </ul>
              </li>
              <li>
                <code>maxUnreadCount</code>
                : 最大已读条数 (number, 默认 1)
                <br />
                <strong>重要:</strong>
                {' '}
                Telegram API 会将目标消息及之前的所有未读消息标记为已读。
                此参数限制最多可以已读多少条消息,如果实际会已读的消息数超过此值,则拒绝执行以防止遗漏消息。
                例如 AI 回复了 3 条消息后触发已读,设置为 3 即可。
              </li>
            </ul>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>markedMessageId</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>action_auto_reply</code>
              {' '}
              - 自动回复
            </h6>
            <p>
              发送自动回复消息，支持
              {' '}
              <code>{'{{变量}}'}</code>
              {' '}
              模板语法
            </p>
            <ul>
              <li>
                <code>template</code>
                : 回复模板 (string, 必填)
                <br />
                可用变量:
                {' '}
                <code>{'{{text}}'}</code>
                ,
                {' '}
                <code>{'{{chatId}}'}</code>
                ,
                {' '}
                <code>{'{{senderId}}'}</code>
                {' '}
                及管道中的其他数据
              </li>
              <li>
                <code>replyToOriginal</code>
                : 回复原消息 (boolean, 默认 true)
              </li>
              <li>
                <code>typingDelayMs</code>
                : 输入延迟(毫秒) (number, 默认 900-1800 随机)
              </li>
            </ul>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>repliedText</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>action_add_queue</code>
              {' '}
              - 添加到客服队列
            </h6>
            <p>手动添加消息到客服队列</p>
            <p>
              <em>无需配置参数</em>
            </p>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>addedToQueue</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>action_forward</code>
              {' '}
              - 转发消息
            </h6>
            <p>转发消息到指定聊天窗口,自动模拟真实用户行为(先已读再转发)</p>
            <ul>
              <li>
                <code>toChatId</code>
                : 目标聊天ID (string, 必填)
                <br />
                输入目标聊天的ID
              </li>
              <li>
                <code>dropAuthor</code>
                : 隐藏原作者 (boolean, 默认 false)
                <br />
                设为 true 时转发消息不显示原作者信息
              </li>
              <li>
                <code>dropCaption</code>
                : 删除原标题 (boolean, 默认 false)
                <br />
                设为 true 时转发消息不包含原标题/说明文字
              </li>
            </ul>
            <p>
              <strong>重要:</strong>
              {' '}
              转发前会自动标记消息为已读,模拟真实用户操作,避免触发 Telegram 反机器人检测
            </p>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>forwardedTo</code>
              ,
              {' '}
              <code>messageId</code>
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>action_send_to</code>
              {' '}
              - 发送消息到窗口
            </h6>
            <p>
              发送新消息到指定聊天窗口,支持
              {' '}
              <code>{'{{变量}}'}</code>
              {' '}
              模板语法
            </p>
            <ul>
              <li>
                <code>toChatId</code>
                : 目标聊天ID (string, 必填)
                <br />
                输入目标聊天的ID
              </li>
              <li>
                <code>template</code>
                : 消息模板 (string, 必填)
                <br />
                可用变量:
                {' '}
                <code>{'{{text}}'}</code>
                ,
                {' '}
                <code>{'{{chatId}}'}</code>
                ,
                {' '}
                <code>{'{{senderId}}'}</code>
                {' '}
                及管道中的其他数据
              </li>
            </ul>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>sentTo</code>
              ,
              {' '}
              <code>sentText</code>
            </p>
          </div>
        </section>

        <section className={styles.docSection}>
          <h5>配置示例</h5>

          <h6>示例 1: AI 回复"已解决"自动标记</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "ai_solved_auto_mark",
  "name": "AI完成自动清除",
  "enabled": true,
  "trigger": {
    "eventType": "bot_reply",
    "senderIds": ["your_bot_id"]
  },
  "pipeline": [
    {
      "id": "check_solved",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "已解决|已处理|问题解决",
        "textMode": "正则"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "mark_done",
      "capabilityId": "action_mark_read",
      "config": {
        "targetMessage": "回复的原消息"
      }
    }
  ]
}`}
          </pre>

          <h6>示例 2: 关键词自动回复</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "keyword_auto_reply",
  "name": "退款自动回复",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "check_keyword",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "退款|退货",
        "textMode": "正则"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "send_reply",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "您好，退款问题请提供订单号，我们会尽快处理",
        "replyToOriginal": true,
        "typingDelayMs": 1200
      }
    }
  ]
}`}
          </pre>

          <h6>示例 3: 未回复自动转人工(支持后续步骤)</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "no_reply_auto_queue",
  "name": "5分钟未回复自动提醒并转人工",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "schedule_check",
      "capabilityId": "check_has_reply",
      "config": {
        "timeWindow": 300
      },
      "onSuccess": {
        "continueNext": false
      },
      "onFailure": {
        "continueNext": true
      }
    },
    {
      "id": "send_wait_message",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "您的问题暂时无人回复,正在为您转接人工客服",
        "replyToOriginal": true
      }
    },
    {
      "id": "add_to_queue",
      "capabilityId": "action_add_queue",
      "config": {}
    }
  ]
}`}
          </pre>

          <h6>示例 4: 检测带图片的消息并回复</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "photo_auto_reply",
  "name": "图片消息自动回复",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "check_has_photo",
      "capabilityId": "check_message",
      "config": {
        "checkHasPhoto": true
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "send_reply",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "感谢您发送图片，我们会尽快查看",
        "replyToOriginal": true
      }
    }
  ]
}`}
          </pre>

          <h6>示例 5: 组合检测(文本+图片)</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "text_photo_combo",
  "name": "退款+图片自动回复",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "check_combo",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "退款",
        "textMode": "包含",
        "checkHasPhoto": true
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "send_reply",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "已收到您的退款申请和凭证图片，我们会在24小时内处理",
        "replyToOriginal": true
      }
    }
  ]
}`}
          </pre>

          <h6>示例 6: 前置规则 (拦截广告并完全接管)</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "spam_filter_prefilter",
  "name": "广告拦截(前置)",
  "enabled": true,
  "executionPhase": "pre-filter",
  "skipPostProcessing": true,
  "trigger": {
    "eventType": "any_message"
  },
  "pipeline": [
    {
      "id": "check_spam",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "加微信|广告|推广",
        "textMode": "正则"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "auto_delete",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "检测到广告消息,已自动处理",
        "replyToOriginal": false
      }
    }
  ]
}`}
          </pre>

          <h6>示例 7: executeAction 传递参数</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "no_reply_with_message",
  "name": "未回复自动提醒并转人工",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "schedule_check",
      "capabilityId": "check_has_reply",
      "config": {
        "timeWindow": 300
      },
      "onFailure": {
        "executeAction": {
          "capabilityId": "action_auto_reply",
          "config": {
            "template": "您的问题已超过5分钟无人回复,已转人工客服处理",
            "replyToOriginal": true
          }
        }
      }
    }
  ]
}`}
          </pre>

          <h6>示例 8: 转发消息到监控群</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "forward_to_monitor",
  "name": "关键词消息转发到监控群",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "check_keyword",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "投诉|退款|差评",
        "textMode": "正则"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "forward_message",
      "capabilityId": "action_forward",
      "config": {
        "toChatId": "-1001234567890",
        "dropAuthor": false,
        "dropCaption": false
      }
    }
  ]
}`}
          </pre>

          <h6>示例 9: 发送通知到管理群</h6>
          <pre className={styles.codeExample}>
            {`{
  "id": "notify_admin_group",
  "name": "重要消息通知管理群",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "check_important",
      "capabilityId": "check_message",
      "config": {
        "textPattern": "紧急|重要|加急",
        "textMode": "正则"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "send_notification",
      "capabilityId": "action_send_to",
      "config": {
        "toChatId": "-1001234567890",
        "template": "🚨 检测到重要消息\\n来自: {{senderId}}\\n内容: {{text}}"
      }
    }
  ]
}`}
          </pre>
        </section>

        <section className={styles.docSection}>
          <h5>注意事项</h5>
          <ul>
            <li>
              <strong>执行顺序:</strong>
              {' '}
              规则列表顺序决定优先级,#1 最先执行
            </li>
            <li>
              <strong>步骤延迟:</strong>
              {' '}
              规则引擎会在每个 action 类型的步骤执行后自动随机延迟(1-10秒),用于防止 Telegram API 限流封号。
            </li>
            <li>
              <strong>executeAction 参数:</strong>
              {' '}
              executeAction 可以是字符串(能力ID)或对象(包含 capabilityId 和 config)。对象形式可以传递参数给动作能力
            </li>
            <li>
              <strong>执行阶段:</strong>
              {' '}
              前置规则(pre-filter)在过滤前执行,后置规则(post-filter)在过滤后执行。前置规则会处理所有消息,性能开销较大,请谨慎使用
            </li>
            <li>
              <strong>跳过后续处理:</strong>
              {' '}
              设置 skipPostProcessing 为 true 可让规则完全接管消息处理,跳过所有后续过滤和规则
            </li>
            <li>
              <strong>触发条件:</strong>
              {' '}
              chatIds 和 senderIds 为空时匹配所有,设置后只匹配指定的
            </li>
            <li>
              <strong>管道中断:</strong>
              {' '}
              onFailure.stopPipeline 默认 false,检测类能力建议设为 true
            </li>
            <li>
              <strong>异步能力:</strong>
              {' '}
              check_has_reply 等异步能力会在后台延迟执行,同步引擎到此暂停。
              时间到后异步执行器会根据 onSuccess/onFailure 继续执行后续步骤
            </li>
            <li>
              <strong>模板变量:</strong>
              {' '}
              使用
              {' '}
              <code>{'{{变量名}}'}</code>
              {' '}
              语法,可访问 pipelineData 中的所有数据
            </li>
            <li>
              <strong>步骤跳转:</strong>
              {' '}
              gotoStep 使用步骤的 id 字段,不是 capabilityId
            </li>
            <li>
              <strong>获取 ID:</strong>
              {' '}
              在聊天中右键消息复制链接,链接末尾的数字即为 senderId 或 chatId
            </li>
            <li>
              <strong>JSON 格式:</strong>
              {' '}
              不支持注释,使用"格式化"按钮检查语法错误
            </li>
            <li>
              <strong>调试技巧:</strong>
              {' '}
              打开浏览器控制台可查看规则执行日志
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default memo(RuleEngineDoc);
