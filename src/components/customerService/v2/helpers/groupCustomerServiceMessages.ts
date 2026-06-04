import type { ApiMessage } from '../../../../api/types';
import type { CustomerServiceMessageGroup } from '../../../../global/types/customerServiceV2';

export const DEFAULT_GROUPING_WINDOW = 60; // 1 minute in seconds

/**
 * Group customer service messages by chat and sender within a time window
 * Groups are chat-independent: messages from different chats won't interfere with each other
 *
 * @param messages - Array of messages to group
 * @param groupingWindow - Time window in seconds for grouping (default: 60 = 1 minute)
 * @returns Array of message groups
 */
export function groupCustomerServiceMessages(
  messages: ApiMessage[],
  groupingWindow: number = DEFAULT_GROUPING_WINDOW,
): CustomerServiceMessageGroup[] {
  if (!messages.length) {
    return [];
  }

  // Step 1: Group messages by chatId first
  const messagesByChatId = new Map<string, ApiMessage[]>();

  messages.forEach((message) => {
    const { chatId } = message;
    if (!messagesByChatId.has(chatId)) {
      messagesByChatId.set(chatId, []);
    }
    messagesByChatId.get(chatId)!.push(message);
  });

  // Step 2: Group messages within each chat by sender and time window
  const allGroups: CustomerServiceMessageGroup[] = [];

  messagesByChatId.forEach((chatMessages, chatId) => {
    let currentGroup: CustomerServiceMessageGroup | undefined;

    chatMessages.forEach((message) => {
      const senderId = message.senderId || '';

      // Check if we should start a new group within this chat
      const shouldStartNewGroup = !currentGroup
        || currentGroup.senderId !== senderId
        || (message.date - currentGroup.lastMessageDate) > groupingWindow;

      if (shouldStartNewGroup) {
        // Save current group if exists
        if (currentGroup) {
          allGroups.push(currentGroup);
        }

        // Create new group
        currentGroup = {
          id: `cs-group-${chatId}-${senderId}-${message.date}`,
          chatId,
          senderId,
          messages: [message],
          firstMessageDate: message.date,
          lastMessageDate: message.date,
          messageCount: 1,
        };
      } else if (currentGroup) {
        // Add to current group
        currentGroup.messages.push(message);
        currentGroup.lastMessageDate = message.date;
        currentGroup.messageCount += 1;
      }
    });

    // Don't forget the last group of this chat
    if (currentGroup) {
      allGroups.push(currentGroup);
    }
  });

  // Step 3: Sort groups by first message date to maintain timeline order
  allGroups.sort((a, b) => a.firstMessageDate - b.firstMessageDate);

  return allGroups;
}
