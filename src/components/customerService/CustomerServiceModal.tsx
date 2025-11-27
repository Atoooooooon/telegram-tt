import React, { memo, useState, useRef, useEffect, useLayoutEffect } from '../../lib/teact/teact';
import { withGlobal, getActions } from '../../global';

import buildClassName from '../../util/buildClassName';

import type { ApiMessage, ApiChat, ApiUser } from '../../api/types';
import { MAIN_THREAD_ID } from '../../api/types';
import { MediaViewerOrigin } from '../../types';
import { CUSTOMER_SERVICE_CONFIG } from '../../config/customerService';
import { getMessageContent } from '../../global/helpers/messageMedia';
import { getMessageReplyInfo } from '../../global/helpers/replies';
import { selectReplyMessage } from '../../global/selectors';

import useLang from '../../hooks/useLang';
import useLastCallback from '../../hooks/useLastCallback';
import useFlag from '../../hooks/useFlag';
import {
  selectCustomerServiceMessages,
  selectActiveCustomerServiceChatIds,
  selectCustomerServiceReplyingMessage,
  selectIsMessageReplied,
} from '../../global/selectors';
import { selectChat, selectUser, selectTabState } from '../../global/selectors';
import { selectCustomerServiceSettings } from '../../global/selectors/customerService';

import Icon from '../common/icons/Icon';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Photo from '../middle/message/Photo';
import Document from '../common/Document';
import EmbeddedMessage from '../common/embedded/EmbeddedMessage';
import CustomerServiceComposer from './CustomerServiceComposer';
import CustomerServiceSettings from './CustomerServiceSettings';

import styles from './CustomerServiceModal.module.scss';

type OwnProps = {
  isOpen?: boolean;
  onClose: NoneToVoidFunction;
};

type StateProps = {
  messages: ApiMessage[];
  activeChatIds: string[];
  chatsById: Record<string, ApiChat>;
  usersById: Record<string, ApiUser>;
  replyingToMessage?: ApiMessage;
  repliedMessageIds: string[];
  replyMessagesById: Record<string, ApiMessage>;
  customerServiceSettings?: {
    monitoredChatIds: string[];
    filteredUserIds: string[];
    regexFilters: Array<{
      source: string;
      flags: string;
    }>;
  };
};

const CustomerServiceModal = ({ 
  isOpen, 
  onClose, 
  messages, 
  activeChatIds,
  chatsById,
  usersById,
  replyingToMessage,
  repliedMessageIds,
  replyMessagesById,
  customerServiceSettings,
}: OwnProps & StateProps) => {
  const lang = useLang();
  
  // 设置弹窗状态
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [mouseDownInfo, setMouseDownInfo] = useState<{
    x: number;
    y: number;
    time: number;
    target: HTMLElement;
  } | null>(null);

  // 简单的滚动管理
  const messageListRef = useRef<HTMLDivElement>(null);

  const handleClose = useLastCallback(() => {
    onClose();
  });

  const handleOpenSettings = useLastCallback(() => {
    setIsSettingsOpen(true);
  });

  const handleCloseSettings = useLastCallback(() => {
    setIsSettingsOpen(false);
  });

  const handleMessageMouseDown = useLastCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // 记录鼠标按下信息
    setMouseDownInfo({
      x: e.clientX,
      y: e.clientY,
      time: Date.now(),
      target
    });

    setIsSelecting(false);
  });

  const handleMessageMouseUp = useLastCallback((e: React.MouseEvent) => {
    // 给文本选择一点时间完成
    setTimeout(() => {
      const selection = window.getSelection();
      const hasTextSelection = selection && selection.toString().length > 0;

      if (hasTextSelection) {
        // 有文本选择，阻止触发reply
        setIsSelecting(true);
        return;
      }

      // 没有文本选择，检查是否是拖动
      if (mouseDownInfo) {
        const moveDistance = Math.sqrt(
          Math.pow(e.clientX - mouseDownInfo.x, 2) +
          Math.pow(e.clientY - mouseDownInfo.y, 2)
        );
        const timeElapsed = Date.now() - mouseDownInfo.time;

        // 如果移动距离超过5像素或者按住时间超过200ms，认为是拖动
        if (moveDistance > 5 || timeElapsed > 200) {
          setIsSelecting(true);
          return;
        }
      }

      setIsSelecting(false);
    }, 10);
  });

  const handleMessageClick = useLastCallback((message: ApiMessage, e?: React.MouseEvent) => {
    // 稍微延迟执行，确保 isSelecting 状态有时间更新
    setTimeout(() => {
      // 如果正在进行文本选择或有文本被选中，不触发回复
      if (isSelecting) {
        setIsSelecting(false);
        return;
      }

      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        return;
      }

      // 强制清除然后设置，确保状态变化
      setCustomerServiceReply({ message: undefined });
      setTimeout(() => {
        setCustomerServiceReply({ message });
      }, 10);
    }, 20);
  });

  const {
    setCustomerServiceReply,
    focusMessage,
    resolveCustomerServiceMessage,
    resetDraftReplyInfo,
    clearCustomerServiceMessages,
    openMediaViewer,
    searchChatMediaMessages
  } = getActions();

  const handleCancelReply = useLastCallback(() => {
    setCustomerServiceReply({ message: undefined });
    resetDraftReplyInfo({});
  });

  const handleGoToContext = useLastCallback((message: ApiMessage) => {
    focusMessage({
      chatId: message.chatId,
      messageId: message.id,
      threadId: MAIN_THREAD_ID,
    });
    onClose(); // 关闭客服窗口，让用户看到原始上下文
  });

  // 处理EmbeddedMessage中图片的点击放大
  const handleEmbeddedMediaClick = useLastCallback((message: ApiMessage, e?: React.MouseEvent) => {
    if (e) {
      // 检查是否点击的是图片区域
      const target = e.target as HTMLElement;
      const isMediaClick = target.closest('.embedded-thumb') || target.closest('.pictogram');

      if (isMediaClick) {
        e.preventDefault();
        e.stopPropagation();

        // 打开媒体查看器
        searchChatMediaMessages({
          chatId: message.chatId,
          threadId: message.threadId,
        });

        openMediaViewer({
          chatId: message.chatId,
          threadId: message.threadId,
          messageId: message.id,
          origin: 'inline' as MediaViewerOrigin,
        });
        return;
      }
    }

    // 非图片区域点击，执行回复
    handleMessageClick(message, e);
  });

  const handleResolveMessage = useLastCallback((message: ApiMessage) => {
    resolveCustomerServiceMessage({ message });
  });

  const handleClearMessages = useLastCallback(() => {
    if (messages.length === 0) return;
    clearCustomerServiceMessages();
  });


  const handlePhotoClick = useLastCallback((message: ApiMessage) => () => {
    // 搜索聊天媒体消息以启用动态加载
    searchChatMediaMessages({
      chatId: message.chatId,
      threadId: MAIN_THREAD_ID,
      currentMediaMessageId: message.id
    });

    openMediaViewer({
      chatId: message.chatId,
      threadId: MAIN_THREAD_ID,
      messageId: message.id,
      origin: MediaViewerOrigin.Inline,
      withDynamicLoading: true,
    });
  });

  // 简单的intersection observer，总是返回true表示可见
  const observeIntersectionForLoading = useLastCallback(() => {
    return true;
  });

  if (!isOpen) {
    return undefined;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      className={styles.modal}
      dialogStyle="width: 100vw !important; height: 100vh !important; max-width: 100vw !important; max-height: 100vh !important; margin: 0; border-radius: 0; top: 0; left: 0; right: 0; bottom: 0;"
      header={
        <div className={styles.header}>
          <h2 className={styles.title}>{lang('CustomerService')}</h2>
          <div className={styles.headerInfo}>
            <span className={styles.messageCount}>
              {messages.length} 条消息
            </span>
            <span className={styles.groupCount}>
              来自 {activeChatIds.length} 个群组
            </span>
          </div>
          <div className={styles.headerActions}>
            <Button
              round
              color="translucent"
              size="smaller"
              ariaLabel={lang('CustomerServiceClearMessages')}
              onClick={handleClearMessages}
              className={styles.clearButton}
              disabled={messages.length === 0}
            >
              <Icon name="delete" />
            </Button>
            <Button
              round
              color="translucent"
              size="smaller"
              ariaLabel={lang('CustomerServiceSettings')}
              onClick={handleOpenSettings}
              className={styles.settingsButton}
            >
              <Icon name="settings" />
            </Button>
            <Button
              round
              color="translucent"
              size="smaller"
              ariaLabel={lang('Close')}
              onClick={handleClose}
              className={styles.closeButton}
            >
              <Icon name="close" />
            </Button>
          </div>
        </div>
      }
    >
        
        <div className={buildClassName(
          styles.content,
          replyingToMessage && styles.contentWithComposer
        )}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="phone" className={styles.emptyIcon} />
              <h3>暂无客服消息</h3>
              
              <div className={styles.configStatus}>
                <div className={styles.statusSection}>
                  <h4>
                    <Icon name="folder" className={styles.statusIcon} />
                    监听群组配置
                  </h4>
                  <div className={styles.statusContent}>
                    <div className={styles.statusNumber}>
                      <span className={styles.count}>
                        {customerServiceSettings?.monitoredChatIds?.length || CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.length}
                      </span>
                      <span className={styles.label}>个群组</span>
                    </div>
                    {(customerServiceSettings?.monitoredChatIds?.length || CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.length) > 0 && (
                      <div className={styles.statusDetails}>
                        {(customerServiceSettings?.monitoredChatIds || CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS)
                          .slice(0, 3)
                          .map(chatId => chatsById[chatId]?.title || `群组 ${chatId}`)
                          .join(', ')}
                        {(customerServiceSettings?.monitoredChatIds?.length || CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.length) > 3 && 
                          ` 等 ${(customerServiceSettings?.monitoredChatIds?.length || CUSTOMER_SERVICE_CONFIG.MONITORED_CHAT_IDS.length)} 个群组`
                        }
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.statusSection}>
                  <h4>
                    <Icon name="user-delete" className={styles.statusIcon} />
                    屏蔽用户配置
                  </h4>
                  <div className={styles.statusContent}>
                    <div className={styles.statusNumber}>
                      <span className={styles.count}>
                        {customerServiceSettings?.filteredUserIds?.length || CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS.length}
                      </span>
                      <span className={styles.label}>个用户</span>
                    </div>
                    {(customerServiceSettings?.filteredUserIds?.length || CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS.length) > 0 && (
                      <div className={styles.statusDetails}>
                        已屏蔽 {customerServiceSettings?.filteredUserIds?.length || CUSTOMER_SERVICE_CONFIG.FILTERED_USER_IDS.length} 个用户的消息
                      </div>
                    )}
                  </div>
                </div>

                <div className={styles.statusSection}>
                  <h4>
                    <Icon name="filter" className={styles.statusIcon} />
                    正则过滤规则
                  </h4>
                  <div className={styles.statusContent}>
                    <div className={styles.statusNumber}>
                      <span className={styles.count}>
                        {customerServiceSettings?.regexFilters?.length || CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS.length}
                      </span>
                      <span className={styles.label}>条规则</span>
                    </div>
                    {(customerServiceSettings?.regexFilters?.length || CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS.length) > 0 && (
                      <div className={styles.regexList}>
                        {(customerServiceSettings?.regexFilters || CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS)
                          .slice(0, 3)
                          .map((filter, index) => (
                            <code key={index} className={styles.regexItem}>
                              {typeof filter === 'object' ? filter.source : filter.source}
                            </code>
                          ))}
                        {(customerServiceSettings?.regexFilters?.length || CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS.length) > 3 && (
                          <span className={styles.moreItems}>
                            +{(customerServiceSettings?.regexFilters?.length || CUSTOMER_SERVICE_CONFIG.REGEX_FILTERS.length) - 3} 更多
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.emptyHint}>
                <Icon name="info" className={styles.hintIcon} />
                <p>当监听的群组有新消息时（经过用户和正则过滤后），将会显示在这里</p>
                <p>如果长时间没有消息，请检查配置是否正确</p>
              </div>
            </div>
          ) : (
            <div
              ref={messageListRef}
              className={styles.messageList}
            >
              {messages.reduce((grouped, message) => {
                // 如果消息有groupedId，将其分组
                if (message.groupedId) {
                  const existingGroup = grouped.find(group =>
                    Array.isArray(group) && group[0].groupedId === message.groupedId
                  );
                  if (existingGroup) {
                    existingGroup.push(message);
                    return grouped;
                  } else {
                    grouped.push([message]);
                    return grouped;
                  }
                } else {
                  // 单独的消息
                  grouped.push(message);
                  return grouped;
                }
              }, [] as (ApiMessage | ApiMessage[])[]).map((messageOrGroup, index) => {
                // 如果是消息组（相册）
                if (Array.isArray(messageOrGroup)) {
                  const mainMessage = messageOrGroup[0]; // 用第一个消息作为主消息
                  const chat = chatsById[mainMessage.chatId];
                  const chatTitle = chat?.title || `群组 ${mainMessage.chatId}`;

                  // 获取发送者信息
                  const sender = mainMessage.senderId ? usersById[mainMessage.senderId] : undefined;
                  const primaryUsername = sender?.usernames?.find(u => u.isActive)?.username;
                  const senderName = sender
                    ? (sender.firstName && sender.lastName
                        ? `${sender.firstName} ${sender.lastName}`.trim()
                        : sender.firstName || sender.lastName || primaryUsername || '未知用户')
                    : '未知用户';

                  // 检查消息是否已回复（使用主消息检查）
                  const messageKey = `${mainMessage.chatId}-${mainMessage.id}`;
                  const isReplied = Array.isArray(repliedMessageIds) && repliedMessageIds.includes(messageKey);

                  // 获取回复信息
                  const replyInfo = getMessageReplyInfo(mainMessage);
                  const replyMessage = replyMessagesById[messageKey];
                  const replySender = replyMessage?.senderId ? usersById[replyMessage.senderId] : undefined;

                  return (
                    <div
                      key={`group-${mainMessage.groupedId}-${index}`}
                      id={`message-${mainMessage.chatId}-${mainMessage.id}`}
                      className={buildClassName(
                        styles.message,
                        isReplied && styles.messageReplied
                      )}
                      onMouseDown={handleMessageMouseDown}
                      onMouseUp={handleMessageMouseUp}
                      onClick={(e) => handleMessageClick(mainMessage, e)}
                      title={lang('CustomerServiceClickToReply')}
                    >
                      <div className={styles.messageHeader}>
                        <div className={styles.headerLeft}>
                          <span className={styles.chatTitle}>{chatTitle}</span>
                          <span className={styles.separator}>-</span>
                          <span className={styles.senderInfo}>
                            <strong>{senderName}</strong>
                            {primaryUsername && (
                              <span className={styles.senderUsername}>@{primaryUsername}</span>
                            )}
                          </span>
                        </div>
                        <span className={styles.messageTime}>
                          {mainMessage.date ? new Date(mainMessage.date * 1000).toLocaleString() : ''}
                        </span>
                      </div>

                      {replyMessage && (
                        <div className={styles.replyContainer}>
                          <EmbeddedMessage
                            message={replyMessage}
                            replyInfo={replyInfo}
                            sender={replySender}
                            onClick={(e) => handleEmbeddedMediaClick(replyMessage, e)}
                          />
                        </div>
                      )}

                      {/* 显示文字内容（如果有） */}
                      {messageOrGroup.some(msg => getMessageContent(msg).text) && (
                        <div className={styles.messageContent}>
                          {messageOrGroup.find(msg => getMessageContent(msg).text)?.content.text?.text || '消息内容'}
                        </div>
                      )}

                      {/* 显示相册中的所有图片 */}
                      <div className={styles.messageMediaGroup}>
                        {messageOrGroup.map((msg) => {
                          const messageContent = getMessageContent(msg);
                          const { photo, document } = messageContent;

                          if (!photo && !document) return null;

                          return (
                            <div key={`${msg.chatId}-${msg.id}`} className={styles.mediaGroupItem}>
                              {photo && (
                                <div
                                  className={styles.messageMedia}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePhotoClick(msg)();
                                  }}
                                >
                                  <Photo
                                    photo={photo}
                                    isOwn={false}
                                    observeIntersection={observeIntersectionForLoading}
                                    canAutoLoad={true}
                                    theme="light"
                                    onClick={() => {}}
                                  />
                                </div>
                              )}

                              {document && (
                                <div className={styles.messageMedia}>
                                  <Document
                                    document={document}
                                    message={msg}
                                    observeIntersection={() => true}
                                    onMediaClick={() => {}}
                                  />
                                </div>
                              )}
                            </div>
                          );
                        }).filter(Boolean)}
                      </div>

                      <div className={styles.messageActions}>
                        <Button
                          size="tiny"
                          color="primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResolveMessage(mainMessage);
                          }}
                          className={styles.resolveButton}
                        >
                          <Icon name="check" />
                          <span className={styles.buttonText}>{lang('CustomerServiceResolve')}</span>
                        </Button>
                        <Button
                          size="tiny"
                          color="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleGoToContext(mainMessage);
                          }}
                          className={styles.contextButton}
                        >
                          <Icon name="arrow-right" />
                          <span className={styles.buttonText}>跳转上下文</span>
                        </Button>
                      </div>
                    </div>
                  );
                }
                // 如果是单个消息
                const message = messageOrGroup;
                const chat = chatsById[message.chatId];
                const chatTitle = chat?.title || `群组 ${message.chatId}`;
                
                // 获取发送者信息
                const sender = message.senderId ? usersById[message.senderId] : undefined;
                const primaryUsername = sender?.usernames?.find(u => u.isActive)?.username;
                const senderName = sender 
                  ? (sender.firstName && sender.lastName 
                      ? `${sender.firstName} ${sender.lastName}`.trim()
                      : sender.firstName || sender.lastName || primaryUsername || '未知用户')
                  : '未知用户';
                
                // 检查消息是否已回复
                const messageKey = `${message.chatId}-${message.id}`;
                const isReplied = Array.isArray(repliedMessageIds) && repliedMessageIds.includes(messageKey);
                
                // 获取消息内容
                const messageContent = getMessageContent(message);
                const { photo, document, text } = messageContent;
                
                // 获取回复信息
                const replyInfo = getMessageReplyInfo(message);
                const replyMessage = replyMessagesById[messageKey];
                const replySender = replyMessage?.senderId ? usersById[replyMessage.senderId] : undefined;
                
                
                return (
                  <div
                    key={`${message.chatId}-${message.id}`}
                    id={`message-${message.chatId}-${message.id}`}
                    className={buildClassName(
                      styles.message,
                      isReplied && styles.messageReplied
                    )}
                    onMouseDown={handleMessageMouseDown}
                    onMouseUp={handleMessageMouseUp}
                    onClick={(e) => handleMessageClick(message, e)}
                    title={lang('CustomerServiceClickToReply')}
                  >
                    <div className={styles.messageHeader}>
                      <div className={styles.headerLeft}>
                        <span className={styles.chatTitle}>{chatTitle}</span>
                        <span className={styles.separator}>-</span>
                        <span className={styles.senderInfo}>
                          <strong>{senderName}</strong>
                          {primaryUsername && (
                            <span className={styles.senderUsername}>@{primaryUsername}</span>
                          )}
                        </span>
                      </div>
                      <span className={styles.messageTime}>
                        {message.date ? new Date(message.date * 1000).toLocaleString() : ''}
                      </span>
                    </div>
                    
                    {replyMessage && (
                      <div className={styles.replyContainer}>
                        <EmbeddedMessage
                          message={replyMessage}
                          replyInfo={replyInfo}
                          sender={replySender}
                          onClick={(e) => handleEmbeddedMediaClick(replyMessage, e)}
                        />
                      </div>
                    )}
                    
                    {text && (
                      <div className={styles.messageContent}>
                        {text?.text || '消息内容'}
                      </div>
                    )}

                    
                    {photo && (
                      <div
                        className={styles.messageMedia}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePhotoClick(message)();
                        }}
                      >
                        <Photo
                          photo={photo}
                          isOwn={false}
                          observeIntersection={observeIntersectionForLoading}
                          canAutoLoad={true}
                          theme="light"
                          onClick={() => {}}
                        />
                      </div>
                    )}
                    
                    {document && (
                      <div className={styles.messageMedia}>
                        <Document
                          document={document}
                          message={message}
                          observeIntersection={() => {}}
                          onMediaClick={() => {}}
                        />
                      </div>
                    )}
                    <div className={styles.messageActions}>
                      <Button
                        size="tiny"
                        color="primary"
                        onClick={(e) => {
                          e.stopPropagation(); // 阻止冒泡到消息点击
                          handleResolveMessage(message);
                        }}
                        className={styles.resolveButton}
                      >
                        <Icon name="check" />
                        <span className={styles.buttonText}>{lang('CustomerServiceResolve')}</span>
                      </Button>
                      <Button
                        size="tiny"
                        color="secondary"
                        onClick={(e) => {
                          e.stopPropagation(); // 阻止冒泡到消息点击
                          handleGoToContext(message);
                        }}
                        className={styles.contextButton}
                      >
                        <Icon name="arrow-right" />
                        <span className={styles.buttonText}>跳转上下文</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {replyingToMessage && (
          <div className={styles.composerContainer}>
            <CustomerServiceComposer
              key={`reply-${replyingToMessage.id}-${replyingToMessage.chatId}`}
              replyToMessage={replyingToMessage}
              onCancel={handleCancelReply}
            />
          </div>
        )}
      
      <CustomerServiceSettings
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
      />
    </Modal>
  );
};

export default memo(withGlobal<OwnProps>((global): StateProps => {
  const messages = selectCustomerServiceMessages(global);
  const activeChatIds = selectActiveCustomerServiceChatIds(global);
  const replyingToMessage = selectCustomerServiceReplyingMessage(global);
  const customerService = selectTabState(global).customerService;
  
  // 处理从Set到数组的迁移
  let repliedMessageIds: string[] = [];
  if (customerService?.repliedMessageIds) {
    if (Array.isArray(customerService.repliedMessageIds)) {
      repliedMessageIds = customerService.repliedMessageIds;
    } else if (customerService.repliedMessageIds instanceof Set) {
      // 如果是Set，转换为数组
      repliedMessageIds = Array.from(customerService.repliedMessageIds);
    } else if (typeof customerService.repliedMessageIds === 'object') {
      // 如果是其他对象，转换为数组
      repliedMessageIds = Object.values(customerService.repliedMessageIds).filter(id => typeof id === 'string');
    }
  }
  
  
  // 构建群组信息映射
  const chatsById: Record<string, ApiChat> = {};
  activeChatIds.forEach(chatId => {
    const chat = selectChat(global, chatId);
    if (chat) {
      chatsById[chatId] = chat;
    }
  });

  // 构建用户信息映射
  const usersById: Record<string, ApiUser> = {};
  messages.forEach(message => {
    if (message.senderId) {
      const user = selectUser(global, message.senderId);
      if (user) {
        usersById[message.senderId] = user;
      }
    }
  });

  // 如果有回复消息，也要获取其发送者信息
  if (replyingToMessage?.senderId && !usersById[replyingToMessage.senderId]) {
    const user = selectUser(global, replyingToMessage.senderId);
    if (user) {
      usersById[replyingToMessage.senderId] = user;
    }
  }

  // 构建回复消息映射
  const replyMessagesById: Record<string, ApiMessage> = {};
  messages.forEach(message => {
    const replyInfo = getMessageReplyInfo(message);
    if (replyInfo) {
      const replyMessage = selectReplyMessage(global, message);
      if (replyMessage) {
        const messageKey = `${message.chatId}-${message.id}`;
        replyMessagesById[messageKey] = replyMessage;
        
        // 确保回复消息的发送者信息也被加载
        if (replyMessage.senderId && !usersById[replyMessage.senderId]) {
          const user = selectUser(global, replyMessage.senderId);
          if (user) {
            usersById[replyMessage.senderId] = user;
          }
        }
      }
    }
  });

  return {
    messages,
    activeChatIds,
    chatsById,
    usersById,
    replyingToMessage,
    repliedMessageIds,
    replyMessagesById,
    customerServiceSettings: selectCustomerServiceSettings(global),
  };
})(CustomerServiceModal));