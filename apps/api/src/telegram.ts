import type { Env, TelegramAuth } from './types';

const encoder = new TextEncoder();

function toArrayBuffer(value: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  return value.slice().buffer as ArrayBuffer;
}

async function hmac(key: ArrayBuffer | Uint8Array | string, message: string): Promise<ArrayBuffer> {
  const rawKey = typeof key === 'string' ? toArrayBuffer(encoder.encode(key)) : toArrayBuffer(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, toArrayBuffer(encoder.encode(message)));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function validateTelegramInitData(initData: string, botToken: string, maxAgeSeconds: number): Promise<TelegramAuth> {
  const params = new URLSearchParams(initData);
  const providedHash = params.get('hash');
  if (!providedHash) throw new Error('Missing Telegram hash');

  const authDate = Number(params.get('auth_date') || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSeconds - authDate > maxAgeSeconds || authDate > nowSeconds + 60) {
    throw new Error('Expired Telegram session');
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== 'hash' && key !== 'signature')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await hmac('WebAppData', botToken);
  const calculatedHash = toHex(await hmac(secretKey, dataCheckString));
  if (!timingSafeEqual(calculatedHash, providedHash.toLowerCase())) throw new Error('Invalid Telegram signature');

  const rawUser = params.get('user');
  if (!rawUser) throw new Error('Missing Telegram user');
  const user = JSON.parse(rawUser) as { id: number | string; username?: string; first_name?: string };

  return {
    id: String(user.id),
    username: user.username,
    firstName: user.first_name || 'BlueTap Player',
    startParam: params.get('start_param') || undefined,
  };
}

export async function authenticateRequest(request: Request, env: Env): Promise<TelegramAuth> {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('tma ')) {
    if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token is not configured');
    const maxAge = Math.max(60, Number(env.AUTH_MAX_AGE_SECONDS || 86400));
    return validateTelegramInitData(auth.slice(4), env.TELEGRAM_BOT_TOKEN, maxAge);
  }

  if (env.ALLOW_DEV_AUTH === 'true') {
    const devId = request.headers.get('X-Dev-Telegram-Id');
    if (devId) {
      return {
        id: devId,
        firstName: request.headers.get('X-Dev-First-Name') || 'Local Player',
        username: 'local_dev',
      };
    }
  }

  throw new Error('Telegram authentication required');
}
