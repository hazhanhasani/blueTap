const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

// Preserve referral attribution while the invited user enters through the Telegram bot.
function referralCodeFromPage(): string {
  const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim() || '';
  if (/^bt[a-z0-9]+$/i.test(fromUrl)) {
    try { window.sessionStorage.setItem('bluetap_referral', fromUrl); } catch {}
    return fromUrl;
  }
  try {
    const saved = window.sessionStorage.getItem('bluetap_referral')?.trim() || '';
    return /^bt[a-z0-9]+$/i.test(saved) ? saved : '';
  } catch {
    return '';
  }
}

function headers() {
  const result: Record<string, string> = { 'Content-Type': 'application/json' };
  const initData = window.Telegram?.WebApp?.initData;
  if (initData) result.Authorization = `tma ${initData}`;
  else if (import.meta.env.VITE_DEV_TELEGRAM_ID) {
    result['X-Dev-Telegram-Id'] = import.meta.env.VITE_DEV_TELEGRAM_ID;
    result['X-Dev-First-Name'] = 'BlueTap Dev';
  }
  const referralCode = referralCodeFromPage();
  if (referralCode) result['X-Referral-Code'] = referralCode;
  return result;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data as T;
}
