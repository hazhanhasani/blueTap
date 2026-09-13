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

function referralFromStart(text: string): string | null {
  const match = text.match(/^\/start(?:@\w+)?(?:\s+ref_([a-z0-9]+))?$/i);
  const code = match?.[1]?.trim() || '';
  return /^bt[a-z0-9]+$/i.test(code) ? code : null;
}

function webAppUrl(appUrl: string, referralCode: string | null): string {
  const url = new URL(appUrl);
  if (referralCode) url.searchParams.set('ref', referralCode);
  return url.toString();
}

export async function handleTelegramUpdate(update: TelegramUpdate, env: Env, appUrl: string): Promise<void> {
  const message = update.message;
  const chatId = message?.chat?.id;
  if (!chatId) return;

  const firstName = message?.from?.first_name?.trim() || 'بازیکن';
  const text = message?.text?.trim() || '';

  if (text.startsWith('/start')) {
    const referralCode = referralFromStart(text);
    await telegramApi(env, 'sendMessage', {
      chat_id: chatId,
      text: referralCode
        ? `${firstName}، دعوتت ثبت شد. وارد BlueTap شو و بازی را شروع کن.`
        : `${firstName}، به BlueTap خوش آمدی.`,
      reply_markup: {
        inline_keyboard: [[
          { text: '🚀 ورود به BlueTap', web_app: { url: webAppUrl(appUrl, referralCode) } },
        ]],
      },
    });
    return;
  }

  await telegramApi(env, 'sendMessage', {
    chat_id: chatId,
    text: 'برای بازی وارد BlueTap شو.',
    reply_markup: {
      inline_keyboard: [[
        { text: '🚀 ورود به BlueTap', web_app: { url: webAppUrl(appUrl, null) } },
      ]],
    },
  });
}
