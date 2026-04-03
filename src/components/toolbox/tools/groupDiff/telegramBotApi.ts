export type TelegramBotIdentity = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
};

type TelegramBotApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

function buildTelegramBotApiUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

function getErrorMessage(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message) {
    return `${prefix}: ${error.message}`;
  }

  return prefix;
}

async function requestTelegramBotApi<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error('请先输入 Bot Token。');
  }

  let response: Response;
  try {
    response = await fetch(buildTelegramBotApiUrl(trimmedToken, method), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });
  } catch (error) {
    throw new Error(getErrorMessage(`调用 Telegram Bot API ${method} 失败`, error));
  }

  let data: TelegramBotApiResponse<T>;
  try {
    data = await response.json() as TelegramBotApiResponse<T>;
  } catch (error) {
    throw new Error(getErrorMessage(`Telegram Bot API ${method} 返回了不可解析的响应`, error));
  }

  if (!response.ok || !data.ok || data.result === undefined) {
    throw new Error(
      data.description
      || `Telegram Bot API ${method} 失败（HTTP ${response.status}${data.error_code ? ` / ${data.error_code}` : ''}）。`,
    );
  }

  return data.result;
}

export function fetchTelegramBotIdentity(token: string): Promise<TelegramBotIdentity> {
  return requestTelegramBotApi<TelegramBotIdentity>(token, 'getMe');
}

export function leaveChatAsBot(token: string, chatId: string): Promise<boolean> {
  return requestTelegramBotApi<boolean>(token, 'leaveChat', {
    chat_id: chatId,
  });
}
