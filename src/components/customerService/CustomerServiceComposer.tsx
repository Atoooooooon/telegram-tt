import React, { memo, useEffect } from '../../lib/teact/teact';
import { withGlobal, getGlobal, setGlobal, getActions } from '../../global';

import type { ApiMessage, ApiPeer, ApiDraft } from '../../api/types';
import type { MessageListType } from '../../types';
import { MAIN_THREAD_ID } from '../../api/types';
import {
  EDITABLE_INPUT_CSS_SELECTOR,
  EDITABLE_INPUT_ID,
} from '../../config';
import { selectSender } from '../../global/selectors';
import { getPeerTitle } from '../../global/helpers/peers';
import { getMessageContent } from '../../global/helpers';
import { getCurrentTabId } from '../../util/establishMultitabRole';
import { updateCurrentMessageList } from '../../global/reducers/messages';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';

import Composer from '../common/Composer';
import Icon from '../common/icons/Icon';
import Button from '../ui/Button';

import styles from './CustomerServiceComposer.module.scss';

type OwnProps = {
  replyToMessage: ApiMessage;
  onCancel: NoneToVoidFunction;
};

type StateProps = {
  sender?: ApiPeer;
};

// 安全更新draft的helper函数
function updateDraftSafely(global: any, chatId: string, threadId: number, draftUpdate: Partial<ApiDraft>) {
  const messages = global.messages || {};
  const byChatId = messages.byChatId || {};
  const chatData = byChatId[chatId] || {};
  const draftsById = chatData.draftsById || {};
  const currentDraft = draftsById[threadId];

  const newDraft: ApiDraft = {
    ...currentDraft,
    ...draftUpdate,
    date: Math.floor(Date.now() / 1000),
    isLocal: true,
  };

  return {
    ...global,
    messages: {
      ...messages,
      byChatId: {
        ...byChatId,
        [chatId]: {
          ...chatData,
          draftsById: {
            ...draftsById,
            [threadId]: newDraft,
          },
        },
      },
    },
  };
}

const CustomerServiceComposer = ({
  replyToMessage,
  onCancel,
  sender,
}: OwnProps & StateProps) => {
  const lang = useLang();
  const { updateDraftReplyInfo } = getActions();

  // 设置当前消息列表和回复信息
  useEffect(() => {
    const tabId = getCurrentTabId();

    // 直接设置当前消息列表为被回复的群组
    let global = getGlobal();
    global = updateCurrentMessageList(
      global,
      replyToMessage.chatId,
      MAIN_THREAD_ID,
      'thread',
      false,
      true,
      tabId
    );
    setGlobal(global);

    // 设置回复信息
    updateDraftReplyInfo({
      replyToMsgId: replyToMessage.id,
      // 不设置 replyToPeerId，让它在同一个群组内正常回复
      quoteText: undefined,
      quoteOffset: undefined,
      tabId,
    });


    // 清理函数 - 清除回复信息
    return () => {
      updateDraftReplyInfo({
        replyToMsgId: undefined,
        quoteText: undefined,
        quoteOffset: undefined,
        tabId,
      });
    };
  }, [replyToMessage.id, replyToMessage.chatId, updateDraftReplyInfo]);


  // 设置全局标记，告诉其他Composer组件不要处理这个聊天的粘贴事件
  useEffect(() => {
    const tabId = getCurrentTabId();
    let global = getGlobal();

    // 在全局状态中标记客服模块正在处理这个聊天
    global = {
      ...global,
      customerServiceActiveChat: replyToMessage.chatId,
    };
    setGlobal(global);

    return () => {
      // 清理标记
      let global = getGlobal();
      global = {
        ...global,
        customerServiceActiveChat: undefined,
      };
      setGlobal(global);
    };
  }, [replyToMessage.chatId]);

  const handleCancelReply = useLastCallback(() => {
    const tabId = getCurrentTabId();

    // 清理回复信息
    updateDraftReplyInfo({
      replyToMsgId: undefined,
      quoteText: undefined,
      quoteOffset: undefined,
      tabId,
    });

    onCancel();
  });


  const messageContent = getMessageContent(replyToMessage);
  const messageText = messageContent.text?.text || '';
  const senderTitle = sender ? getPeerTitle(lang, sender) : 'Unknown';

  return (
    <div className={styles.customerServiceComposer}>
      {/* {renderReplyHeader()} */}
      <Composer
        type="messageList"
        chatId={replyToMessage.chatId}
        threadId={MAIN_THREAD_ID}
        messageListType={'thread' as MessageListType}
        dropAreaState={undefined}
        onDropHide={undefined}
        isReady={true}
        isMobile={false}
        editableInputId={EDITABLE_INPUT_ID}
        editableInputCssSelector={EDITABLE_INPUT_CSS_SELECTOR}
        inputId="message-input-text"
        inputPlaceholder={lang('Reply')}
        className="customer-service-composer-input"
      />
    </div>
  );
};

export default memo(withGlobal<OwnProps>(
  (global, { replyToMessage }): StateProps => {
    const sender = selectSender(global, replyToMessage);
    return {
      sender,
    };
  },
)(CustomerServiceComposer));