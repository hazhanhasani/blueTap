import type { Env } from './types';

type TelegramMessage = {
  chat?: { id?: number | string };
  text?: string;
  from?: { first_name?: string };
};

type TelegramUpdate = {
  message?: TelegramMessage;
};

async function telegramApi(env: Env, method: string, body: unknown): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is not configured');

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API ${method} failed: ${response.status} ${text}`);
  }
}

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env, appUrl: string): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId) return;

  const firstName = message?.from?.first_name?.trim() || 'Player';
  const text = message?.text?.trim() || '';

  if (text.startsWith('/start')) {
    await telegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: `Welcome ${firstName}!\n\nBlueTap is the official BlueCoin (BLUEX) game. Tap, complete missions, invite friends and earn Blue Points for Season 1.`,
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 Open BlueTap', web_app: { url: appUrl } },
        ]],
      },
    });
    return;
  }

  await telegramApi(env, 'sendMessage', {
    chat_id: chatId,
    text: 'Open BlueTap to play and collect Blue Points.',
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 Open BlueTap', web_app: { url: appUrl } },
      ]],
    },
  });
}
