import type { MessageListType, ThreadId } from '../../../types';

export function buildMessageListRenderKey(
  chatId: string,
  threadId: ThreadId,
  type: MessageListType,
  localKey: string | number,
): string {
  return `${chatId}:${threadId}:${type}:${localKey}`;
}
