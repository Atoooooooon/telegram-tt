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

  hasToken(config) {
    return Boolean(config.telegramBotToken);
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

  async updateAlert(config, messageId, text) {
    if (!this.isEnabled(config) || !messageId) {
      return { ok: false, skipped: true };
    }

    try {
      await this.request(config, 'editMessageText', {
        chat_id: config.telegramAlertChatId,
        message_id: Number(messageId),
        text,
        disable_web_page_preview: true,
      });
      return { ok: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('message is not modified')) {
        return { ok: true, skipped: true };
      }
      this.log('Telegram bot editMessageText failed', error);
      return { ok: false };
    }
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('message to delete not found')) {
        return { ok: true, skipped: true, notFound: true };
      }
      this.log('Telegram bot deleteMessage failed', error);
      return { ok: false };
    }
  }

  async getUpdates(config, params = {}) {
    if (!this.hasToken(config)) {
      return { ok: false, skipped: true, updates: [] };
    }

    try {
      const data = await this.request(config, 'getUpdates', {
        timeout: 0,
        allowed_updates: ['message'],
        ...params,
      });

      return {
        ok: true,
        updates: Array.isArray(data.result) ? data.result : [],
      };
    } catch (error) {
      this.log('Telegram bot getUpdates failed', error);
      return { ok: false, updates: [] };
    }
  }
}
