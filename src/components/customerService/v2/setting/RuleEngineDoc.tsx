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
              - 综合检测 (全能校验器)
            </h6>
            <p>检查消息属性、Pipeline 变量或系统元数据。支持多条件组合。</p>
            <ul>
              <li><strong>基础检查:</strong> <code>textPattern</code> (支持包含/正则/全等), <code>checkHasPhoto</code>, <code>checkHasVideo</code>, <code>checkIsReply</code></li>
              <li>
                <strong>变量对比 (Advanced):</strong>
                <ul>
                  <li><code>variableKey</code>: 要检查的变量名 (如 <code>botReplyText</code> 或 <code>chat.title</code>)</li>
                  <li><code>variableOperator</code>: 操作符 (contains, equals, regex, exists, not_exists)</li>
                  <li><code>variableExpectedValue</code>: 期望值 (支持 <code>{"{{变量}}"}</code> 语法)</li>
                </ul>
              </li>
            </ul>
            <p><strong>逻辑:</strong> 所有启用的检查项必须全部通过 (AND 逻辑) 才会返回 success。</p>
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
              <code>text_processor</code>
              {' '}
              - 文本处理器
            </h6>
            <p>通用文本处理能力，支持清洗、提取、转换、验证四个阶段</p>

            <h6>输入/输出</h6>
            <ul>
              <li>
                <code>inputField</code>
                : 输入字段名 (string, 默认 text)
              </li>
              <li>
                <code>outputField</code>
                : 输出字段名 (string, 默认 extractedText)
              </li>
            </ul>

            <h6>清洗配置 (Clean)</h6>
            <ul>
              <li>
                <code>cleanEnabled</code>
                : 启用清洗 (boolean, 默认 false)
              </li>
              <li>
                <code>cleanPrefixes</code>
                : 移除前缀 (string, 默认 /ds,/df,/d,/订单,/单号)
              </li>
              <li>
                <code>cleanTrim</code>
                : 去除首尾空格 (boolean, 默认 true)
              </li>
              <li>
                <code>cleanRemoveSpecial</code>
                : 移除特殊字符 (boolean, 默认 false)
              </li>
              <li>
                <code>cleanRemoveWhitespace</code>
                : 移除所有空格 (boolean, 默认 false)
              </li>
            </ul>

            <h6>提取配置 (Extract)</h6>
            <ul>
              <li>
                <code>extractEnabled</code>
                : 启用提取 (boolean, 默认 false)
              </li>
              <li>
                <code>extractPattern</code>
                : 正则表达式 (string, 如 数字模式 <code>{"([0-9]{8,})"}</code>)
              </li>
              <li>
                <code>extractFlags</code>
                : 正则 flags (string, 如 g、i、m)
              </li>
              <li>
                <code>extractGroupIndex</code>
                : 捕获组索引 (number, 默认 0)
              </li>
              <li>
                <code>extractFallback</code>
                : 未匹配默认值 (string)
              </li>
            </ul>

            <h6>转换配置 (Transform)</h6>
            <ul>
              <li>
                <code>transformEnabled</code>
                : 启用转换 (boolean, 默认 false)
              </li>
              <li>
                <code>transformCase</code>
                : 大小写 (string, none/upper/lower/capitalize)
              </li>
              <li>
                <code>transformReplaceFrom</code>
                : 替换内容 (string)
              </li>
              <li>
                <code>transformReplaceTo</code>
                : 替换为 (string)
              </li>
            </ul>

            <h6>验证配置 (Validate)</h6>
            <ul>
              <li>
                <code>validateEnabled</code>
                : 启用验证 (boolean, 默认 false)
              </li>
              <li>
                <code>validateMinLength</code>
                : 最小长度 (number)
              </li>
              <li>
                <code>validateMaxLength</code>
                : 最大长度 (number)
              </li>
              <li>
                <code>validateNumeric</code>
                : 仅数字 (boolean, 默认 false)
              </li>
            </ul>

            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>outputField</code>
              {' '}
              (默认
              {' '}
              <code>extractedText</code>
              )
              ,
              {' '}
              <code>matchedText</code>
              ,
              {' '}
              <code>validated</code>
            </p>

            <h6>处理示例</h6>
            <pre className={styles.codeExample}>
              {`// 输入: "/ds 511684153654你好请问"
{
  "capabilityId": "text_processor",
  "config": {
    "inputField": "text",
    "outputField": "orderNumber",
    "cleanEnabled": true,
    "cleanPrefixes": "/ds,/df,/d,/订单,/单号",
    "cleanTrim": true,
    "cleanRemoveSpecial": true,
    "extractEnabled": true,
    "extractPattern": "([0-9]{8,})",
    "extractGroupIndex": 0,
    "validateEnabled": true,
    "validateMinLength": 8,
    "validateMaxLength": 32,
    "validateNumeric": true
  }
}
// 输出: {{orderNumber}} = "511684153654"`}
            </pre>

            <h6>常见输入处理</h6>
            <p>
              <strong>格式:</strong>
              {' '}
              输入
              {' '}
              → 清洗后 → 提取结果
            </p>
            <ul>
              <li>
                <code>/ds 511684153654</code>
                {' '}
                → <code>511684153654</code>
                {' '}
                → <code>511684153654</code>
              </li>
              <li>
                <code>/ds 511684153654你好请问</code>
                {' '}
                → <code>511684153654</code>
                {' '}
                → <code>511684153654</code>
              </li>
              <li>
                <code>/df 12532532534</code>
                {' '}
                → <code>12532532534</code>
                {' '}
                → <code>12532532534</code>
              </li>
              <li>
                <code>6203564895</code>
                {' '}
                → <code>6203564895</code>
                {' '}
                → <code>6203564895</code>
              </li>
            </ul>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>ocr_image</code>
              {' '}
              - 图片文字识别
            </h6>
            <p>调用外部 OCR 服务识别图片文字(百度/腾讯)，可将结果写入 pipelineData 供后续步骤使用</p>

            <h6>基础配置</h6>
            <ul>
              <li>
                <code>provider</code>
                : 服务商 (string, baidu/tencent, 默认 baidu)
              </li>
              <li>
                <code>outputField</code>
                : 识别文本输出字段 (string, 默认 ocrText)
              </li>
              <li>
                <code>linesField</code>
                : 行结果输出字段 (string, 默认 ocrLines)
              </li>
              <li>
                <code>rawField</code>
                : 原始响应输出字段 (string, 默认 ocrRaw)
              </li>
              <li>
                <code>setText</code>
                : 写入 pipelineData.text (boolean, 默认 true)
              </li>
              <li>
                <code>ignoreMissingImage</code>
                : 无图片时忽略 (boolean, 默认 false)
              </li>
              <li>
                <code>failOnEmpty</code>
                : 识别为空视为失败 (boolean, 默认 true)
              </li>
              <li>
                <code>languageType</code>
                : 语言参数(服务商自定义) (string, 可选)
              </li>
            </ul>

            <h6>百度 OCR 配置</h6>
            <ul>
              <li>
                <code>baiduApiKey</code>
                : 百度 API Key (string)
              </li>
              <li>
                <code>baiduSecretKey</code>
                : 百度 Secret Key (string)
              </li>
              <li>
                <code>baiduAccessToken</code>
                : 百度 Access Token(可选)
              </li>
              <li>
                <code>baiduProxyUrl</code>
                : 百度 Proxy 地址(可选)
              </li>
              <li>
                <code>baiduDetectDirection</code>
                : 检测图像方向 (boolean)
              </li>
              <li>
                <code>baiduDetectLanguage</code>
                : 检测语言 (boolean)
              </li>
              <li>
                <code>baiduParagraph</code>
                : 返回段落信息 (boolean)
              </li>
              <li>
                <code>baiduProbability</code>
                : 返回置信度 (boolean)
              </li>
            </ul>

            <h6>腾讯 OCR 配置</h6>
            <ul>
              <li>
                <code>tencentSecretId</code>
                : 腾讯 SecretId (string)
              </li>
              <li>
                <code>tencentSecretKey</code>
                : 腾讯 SecretKey (string)
              </li>
              <li>
                <code>tencentRegion</code>
                : 腾讯 Region(可选)
              </li>
              <li>
                <code>tencentIsPdf</code>
                : 是否为 PDF (boolean)
              </li>
              <li>
                <code>tencentPdfPageNumber</code>
                : PDF 页码 (number)
              </li>
              <li>
                <code>tencentIsWords</code>
                : 输出单字信息 (boolean)
              </li>
            </ul>

            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>outputField</code>
              (默认
              {' '}
              <code>ocrText</code>
              )
              ,
              {' '}
              <code>linesField</code>
              ,
              {' '}
              <code>rawField</code>
              ,
              {' '}
              <code>ocrProvider</code>
            </p>

            <h6>配置示例(百度)</h6>
            <pre className={styles.codeExample}>
              {`{
  "capabilityId": "ocr_image",
  "config": {
    "provider": "baidu",
    "baiduProxyUrl": "/api/ocr/baidu",
    "baiduApiKey": "YOUR_API_KEY",
    "baiduSecretKey": "YOUR_SECRET_KEY",
    "outputField": "ocrText"
  }
}`}
            </pre>
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
              发送新消息到指定聊天窗口, 支持
              {' '}
              <code>{'{{变量}}'}</code>
              {' '}
              模板语法。
            </p>
            <ul>
              <li>
                <code>toChatId</code>
                : 目标聊天ID (string, 必填)
              </li>
              <li>
                <code>template</code>
                : 消息模板 (string, 必填)
              </li>
            </ul>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>sentTo</code>
              ,
              {' '}
              <code>sentText</code>
              ,
              {' '}
              <code>sentMessageId</code>
              {' '}
              (用于后续等待回复)
            </p>
          </div>

          <div className={styles.capabilityItem}>
            <h6>
              <code>wait_for_reply</code>
              {' '}
              - 等待回复 (异步)
            </h6>
            <p>
              在指定聊天中等待特定消息的回复
              <strong>(非阻塞异步能力)</strong>
            </p>
            <ul>
              <li>
                <code>chatId</code>
                : 目标聊天ID (string, 默认当前聊天)
              </li>
              <li>
                <code>messageIdField</code>
                : 消息ID来源字段 (string, 默认 sentMessageId)
              </li>
              <li>
                <code>timeout</code>
                : 超时秒数 (number, 默认 60)
              </li>
              <li>
                <code>pollInterval</code>
                : 轮询间隔秒数 (number, 默认 5)
              </li>
            </ul>
            <p>
              <strong>输出数据:</strong>
              {' '}
              <code>botReplyText</code>
              ,
              {' '}
              <code>botReplyMessageId</code>
            </p>
          </div>
        </section>

        <section className={styles.docSection}>
          <h5>全能示例：OCR 识别 + 跨群机器人查询</h5>
          <p>此示例展示了如何将多个能力组合成一个自动化的查单工作流：</p>
          <pre className={styles.codeExample}>
            {`{
  "id": "master_ocr_query",
  "name": "全自动 OCR 跨群查单",
  "enabled": true,
  "trigger": { "eventType": "customer_message" },
  "pipeline": [
    {
      "id": "check_photo",
      "capabilityId": "check_message",
      "config": { "checkHasPhoto": true },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "ocr_step",
      "capabilityId": "ocr_image",
      "config": { "provider": "baidu", "setText": true }
    },
    {
      "id": "extract_rrn",
      "capabilityId": "text_processor",
      "config": {
        "extractEnabled": true,
        "extractPattern": "RRN:?\\s*([A-Z0-9]{10,15})",
        "outputField": "rrn"
      },
      "onFailure": { "stopPipeline": true }
    },
    {
      "id": "send_to_bot",
      "capabilityId": "action_send_to",
      "config": {
        "toChatId": "-100123456789",
        "template": "查询单号: {{rrn}}"
      }
    },
    {
      "id": "wait_bot",
      "capabilityId": "wait_for_reply",
      "config": {
        "chatId": "-100123456789",
        "messageIdField": "sentMessageId",
        "timeout": 60
      }
    },
    {
      "id": "reply_user",
      "capabilityId": "action_auto_reply",
      "config": {
        "template": "您的订单 {{rrn}} 状态：\\n{{botReplyText}}"
      }
    }
  ]
}`}
          </pre>

          <h6>常用精简示例</h6>
          <ul>
            <li>
              <strong>AI 已解决自动已读</strong>: 监听 <code>bot_reply</code>，使用 <code>check_message</code> 正则匹配关键词，最后 <code>action_mark_read</code>。
            </li>
            <li>
              <strong>5分钟超时转人工</strong>: 使用 <code>check_has_reply</code> 设置 300秒，在 <code>onFailure</code> 中执行 <code>action_add_queue</code>。
            </li>
            <li>
              <strong>关键词转发</strong>: <code>check_message</code> 匹配敏感词，<code>action_forward</code> 到管理群。
            </li>
          </ul>
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
