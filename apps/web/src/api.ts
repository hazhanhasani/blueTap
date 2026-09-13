const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function headers() {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) result.Authorization = `tma ${initData}`;
  else if (import.meta.env.VITE_DEV_TELEGRAM_ID) {
    result['X-Dev-Telegram-Id'] = import.meta.env.VITE_DEV_TELEGRAM_ID;
    result['X-Dev-First-Name'] = 'BlueTap Dev';
  }
  return result;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}
