import type { Env, UserRow } from './types';

export const DEFAULT_OWNER_TELEGRAM_ID = '8636742848';

export function ownerTelegramId(env: Env) {
  return String(env.OWNER_TELEGRAM_ID || DEFAULT_OWNER_TELEGRAM_ID).trim();
}

export function isOwner(env: Env, userOrId: UserRow | string | number) {
  const id = typeof userOrId === 'object' ? userOrId.telegram_id : String(userOrId);
  return id === ownerTelegramId(env);
}
