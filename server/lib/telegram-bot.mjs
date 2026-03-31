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

  async request(config, method, payload) {
    const response = await fetch(buildApiUrl(config.telegramBotToken, method), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(`Telegram bot ${method} failed: ${response.status} ${JSON.stringify(data)}`);
    }

    return data;
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

    const data = await this.request(config, 'sendMessage', payload);

    return { ok: true, messageId: data.result?.message_id };
  }

  async deleteMessage(config, messageId) {
    if (!this.isEnabled(config) || !messageId) {
      return { ok: false, skipped: true };
    }

    try {
      await this.request(config, 'deleteMessage', {
        chat_id: config.telegramAlertChatId,
        message_id: Number(messageId),
      });
      return { ok: true };
    } catch (error) {
      this.log('Telegram bot deleteMessage failed', error);
      return { ok: false };
    }
  }
}
