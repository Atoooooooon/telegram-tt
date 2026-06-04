/// <reference types="jest" />

import { buildMessageListRenderKey } from './messageListKeys';

describe('buildMessageListRenderKey', () => {
  it('scopes repeated message ids by chat', () => {
    const messageKey = 'message-42';

    expect(buildMessageListRenderKey('-1001', 1, 'thread', messageKey))
      .not.toBe(buildMessageListRenderKey('-1002', 1, 'thread', messageKey));
  });

  it('scopes repeated message ids by thread and list type', () => {
    const messageKey = 'message-42';

    expect(buildMessageListRenderKey('-1001', 1, 'thread', messageKey))
      .not.toBe(buildMessageListRenderKey('-1001', 2, 'thread', messageKey));
    expect(buildMessageListRenderKey('-1001', 1, 'thread', messageKey))
      .not.toBe(buildMessageListRenderKey('-1001', 1, 'scheduled', messageKey));
  });
});
