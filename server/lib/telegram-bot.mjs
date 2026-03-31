function buildApiUrl(token, method) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

export class TelegramBotClient {
  constructor(log) {
    this.log = log;
  }

  isEnabled(config) {
    return Boolean(config.telegramBotToken && config.telegramAlertChatId);
  }

  async sendAlert(config, text) {
    if (!this.isEnabled(config)) {
      this.log('Telegram bot alert skipped: missing bot configuration');
      return { ok: false, skipped: true };
    }

    const payload = {
      chat_id: config.telegramAlertChatId,
      text,
      disable_web_page_preview: true,
    };

    if (config.telegramAlertThreadId) {
      payload.message_thread_id = Number(config.telegramAlertThreadId);
    }

    const response = await fetch(buildApiUrl(config.telegramBotToken, 'sendMessage'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram bot sendMessage failed: ${response.status} ${JSON.stringify(data)}`);
    }

    return { ok: true, messageId: data.result?.message_id };
  }
}
