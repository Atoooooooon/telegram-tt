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
            </li>
            <li>
              <code>name</code>
              : 规则显示名称 (string, 必填)
            </li>
            <li>
              <code>enabled</code>
              : 是否启用 (boolean, 必填)
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
              : 步骤 ID (string)
            </li>
            <li>
              <code>capabilityId</code>
              : 能力 ID (string)
              <ul>
                <li>
                  <code>check_text_match</code>
                  {' '}
                  - 文本匹配检查
                </li>
                <li>
                  <code>action_auto_reply</code>
                  {' '}
                  - 自动回复
                </li>
              </ul>
            </li>
            <li>
              <code>config</code>
              : 配置对象 (object)
            </li>
            <li>
              <code>onSuccess</code>
              : 成功时行为 (可选)
              <ul>
                <li>
                  <code>continueNext</code>
                  : 继续下一步
                </li>
                <li>
                  <code>gotoStep</code>
                  : 跳转到指定步骤
                </li>
              </ul>
            </li>
            <li>
              <code>onFailure</code>
              : 失败时行为 (可选)
              <ul>
                <li>
                  <code>stopPipeline</code>
                  : 停止执行
                </li>
                <li>
                  <code>gotoStep</code>
                  : 跳转到指定步骤
                </li>
              </ul>
            </li>
          </ul>
        </section>

        <section className={styles.docSection}>
          <h5>配置示例</h5>
          <pre className={styles.codeExample}>
            {`{
  "id": "rule_example",
  "name": "示例规则",
  "enabled": true,
  "trigger": {
    "eventType": "customer_message"
  },
  "pipeline": [
    {
      "id": "step1",
      "capabilityId": "check_text_match",
      "config": {
        "pattern": "关键词",
        "mode": "包含"
      },
      "onSuccess": { "continueNext": true },
      "onFailure": { "stopPipeline": true }
    }
  ]
}`}
          </pre>
        </section>

        <section className={styles.docSection}>
          <h5>注意事项</h5>
          <ul>
            <li>规则在数组中的顺序决定执行优先级,越靠前优先级越高</li>
            <li>每个规则可以包含多个管道步骤,按顺序执行</li>
            <li>步骤失败时可以选择停止整个管道或跳转到其他步骤</li>
            <li>配置对象 (config) 的具体字段取决于所使用的能力 ID</li>
          </ul>
        </section>
      </div>
    </div>
  );
};

export default memo(RuleEngineDoc);
