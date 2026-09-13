import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react';
import { api } from './api';
import type { Bootstrap, Challenge, LeagueState, Profile, Task } from './types';
import './features.css';

type Tab = 'mine' | 'boost' | 'tasks' | 'friends' | 'wallet';
type FloatingTap = { id: number; x: number; y: number; value: number };

const nf = new Intl.NumberFormat('fa-IR');

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function durationLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${nf.format(hours)} ساعت و ${nf.format(minutes)} دقیقه`;
  if (minutes > 0) return `${nf.format(minutes)} دقیقه و ${nf.format(secs)} ثانیه`;
  return `${nf.format(secs)} ثانیه`;
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (!message) return fallback;
  if (/Unauthorized|Invalid Telegram|signature|init.?data/i.test(message)) return 'ورود تلگرام معتبر نیست. بازی را از ربات دوباره باز کن.';
  if (/HTTP\s*5\d\d|Internal server|Failed to fetch|NetworkError|fetch/i.test(message)) return 'ارتباط با بازی برقرار نشد. چند لحظه دیگر دوباره تلاش کن.';
  if (/Maximum .*level reached/i.test(message)) return 'به بالاترین سطح رسیده‌ای.';
  if (/not found/i.test(message)) return 'این مورد در دسترس نیست.';
  return /[A-Za-z]{4,}/.test(message) ? fallback : message;
}

function levelLabel(name: string) {
  return ({ Starter: 'شروع', Explorer: 'کاوشگر', Wave: 'موج', Captain: 'کاپیتان', Legend: 'افسانه' } as Record<string, string>)[name] || name;
}

function seasonLabel(name: string) {
  if (/season\s*1/i.test(name)) return 'فصل ۱';
  return name;
}

function leagueLabel(name: string | null | undefined) {
  if (!name) return '';
  return ({ Bronze: 'برنزی', Silver: 'نقره‌ای', Gold: 'طلایی', Diamond: 'الماس', Master: 'استاد' } as Record<string, string>)[name] || name;
}

function skinLabel(name: string) {
  return ({ 'Blue Classic': 'آبی کلاسیک', 'Neon Pulse': 'نئون', 'Golden Gram': 'طلایی', 'Cyber Blue': 'سایبری' } as Record<string, string>)[name] || name;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [league, setLeague] = useState<LeagueState | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [floatingTaps, setFloatingTaps] = useState<FloatingTap[]>([]);
  const [clock, setClock] = useState(Date.now());
  const [autoMineSessionConfirmed, setAutoMineSessionConfirmed] = useState(false);
  const pendingTaps = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const flushing = useRef(false);
  const tapVisualId = useRef(0);
  const energyRef = useRef(0);
  const autoMineSyncing = useRef(false);
  const wallet = useTonWallet();

  const telegramInitData = window.Telegram?.WebApp?.initData?.trim() || '';
  const allowDevAccess = Boolean(import.meta.env.VITE_DEV_TELEGRAM_ID);
  const telegramAccessAllowed = Boolean(telegramInitData) || allowDevAccess;

  // Server responses can finish out of order while taps and auto-mine sync run together.
  // Never let an older profile snapshot overwrite a newer one. While taps are still
  // queued/in flight, also preserve the lower local energy value so energy cannot jump.
  const applyServerProfile = useCallback((next: Profile) => {
    setProfile((current) => {
      if (!current) return next;
      if (next.updatedAt < current.updatedAt) return current;
      if (pendingTaps.current > 0 || flushing.current) {
        return { ...next, energy: Math.min(current.energy, next.energy) };
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!telegramAccessAllowed) return;
    try {
      const response = await api<Bootstrap>('/api/bootstrap');
      setData(response);
      applyServerProfile(response.profile);
      setTasks(response.tasks);
      setChallenges(response.challenges);
      setLeague(response.league);
      setError(null);
    } catch (e) {
      setError(friendlyError(e, 'ارتباط برقرار نشد.'));
    }
  }, [telegramAccessAllowed]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab !== 'friends' || !telegramAccessAllowed) return;
    void load();
    const refresh = window.setInterval(() => void load(), 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tab, telegramAccessAllowed, load]);

  useEffect(() => {
    energyRef.current = profile?.energy ?? 0;
  }, [profile?.energy]);

  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash(null), 2600);
    return () => window.clearTimeout(id);
  }, [flash]);

  const flush = useCallback(async () => {
    if (flushing.current || pendingTaps.current <= 0) return;
    flushing.current = true;
    const count = Math.min(20, pendingTaps.current);
    pendingTaps.current -= count;
    try {
      const response = await api<{
        awarded: number;
        awardedTaps: number;
        tapValue: number;
        energySpent: number;
        luckyBonus: number;
        luckyHits: number;
        highestLuckyMultiplier: number;
        comboCount: number;
        comboMultiplier: number;
        profile: Profile;
      }>('/api/tap', { method: 'POST', body: JSON.stringify({ count }) });
      applyServerProfile(response.profile);
      if (response.luckyHits > 0) window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      pendingTaps.current = 0;
      setError(friendlyError(e, 'ثبت ضربه انجام نشد.'));
      await load();
    } finally {
      flushing.current = false;
      if (pendingTaps.current > 0) window.setTimeout(flush, 120);
    }
  }, [load]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null;
      void flush();
    }, 180);
  }, [flush]);

  const turboActive = Boolean(profile && profile.turboUntil > clock);
  const turboRemainingSeconds = profile && turboActive ? Math.max(0, Math.ceil((profile.turboUntil - clock) / 1000)) : 0;
  const tapReward = profile ? profile.tapPower * (turboActive ? profile.turboMultiplier : 1) : 1;
  const autoMineExpired = Boolean(profile && clock >= profile.autoMineDeadlineAt);
  const autoMineRemainingSeconds = profile && !autoMineExpired ? Math.max(0, Math.ceil((profile.autoMineDeadlineAt - clock) / 1000)) : 0;
  const autoBoostActive = Boolean(profile && profile.autoMineBoostUntil > clock);
  const autoBoostRemainingSeconds = profile && autoBoostActive ? Math.max(0, Math.ceil((profile.autoMineBoostUntil - clock) / 1000)) : 0;
  const chestRemainingSeconds = profile?.chestReady ? 0 : profile ? Math.max(0, Math.ceil((profile.chestNextAt - clock) / 1000)) : 0;
  const eventRemainingSeconds = profile?.event.active && profile.event.endsAt ? Math.max(0, Math.ceil((profile.event.endsAt - clock) / 1000)) : 0;
  const jackpotRemainingSeconds = data ? Math.max(0, Math.ceil((data.jackpot.nextDrawAt - clock) / 1000)) : 0;

  const autoMineLivePending = useMemo(() => {
    if (!profile) return 0;
    const end = Math.min(clock, profile.autoMineDeadlineAt);
    const start = Math.min(profile.autoMineLastAt, end);
    const elapsed = Math.max(0, end - start);
    const boostedEnd = Math.min(end, profile.autoMineBoostUntil);
    const boostedMs = Math.max(0, boostedEnd - start);
    const normal = (elapsed * profile.autoMineBaseRatePerMinute) / 60_000;
    const boostBonus = (boostedMs * profile.autoMineBaseRatePerMinute * (profile.autoMineBoostMultiplier - 1)) / 60_000;
    return Math.floor(normal + boostBonus);
  }, [clock, profile]);

  const addFloatingTap = useCallback((x: number, y: number, value = 1) => {
    const id = ++tapVisualId.current;
    setFloatingTaps((prev) => [...prev.slice(-39), { id, x, y, value }]);
    window.setTimeout(() => setFloatingTaps((prev) => prev.filter((item) => item.id !== id)), 760);
  }, []);

  const tap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!profile || energyRef.current < tapReward) return;
    energyRef.current -= tapReward;
    const rect = event.currentTarget.getBoundingClientRect();
    addFloatingTap(event.clientX - rect.left, event.clientY - rect.top, tapReward);
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(turboActive ? 'medium' : 'light');
    pendingTaps.current += 1;
    setProfile((p) => p ? { ...p, energy: Math.max(0, p.energy - tapReward) } : p);
    scheduleFlush();
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setProfile((p) => p && p.energy < p.maxEnergy ? { ...p, energy: Math.min(p.maxEnergy, p.energy + p.energyRegenPerSecond) } : p);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const confirmAutoMine = useCallback(async (manual = true) => {
    if (autoMineSyncing.current) return;
    autoMineSyncing.current = true;
    if (manual) setBusy(true);
    try {
      const result = await api<{ awarded: number; burned: number; shieldUsed: boolean; profile: Profile }>('/api/auto-mine/confirm', { method: 'POST', body: JSON.stringify({ manual }) });
      applyServerProfile(result.profile);
      setAutoMineSessionConfirmed(true);
      setClock(Date.now());
      if (result.shieldUsed) setFlash(`🛡️ محافظ ماین فعال شد و ${nf.format(result.awarded)} امتیاز حفظ شد`);
      else if (result.burned > 0) setError(`${nf.format(result.burned)} امتیاز ماین خودکار به‌دلیل پایان مهلت از بین رفت.`);
      else if (manual) setFlash(`🤖 +${nf.format(result.awarded)} امتیاز از ماین خودکار`);
    } catch (e) {
      if (manual) setError(friendlyError(e, 'تأیید ماین خودکار انجام نشد.'));
    } finally {
      autoMineSyncing.current = false;
      if (manual) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!autoMineSessionConfirmed || !profile) return;
    const syncIfActive = () => {
      const now = Date.now();
      if (now >= profile.autoMineDeadlineAt) {
        setClock(now);
        setAutoMineSessionConfirmed(false);
        return;
      }
      if (document.visibilityState === 'visible') void confirmAutoMine(false);
    };
    const id = window.setInterval(syncIfActive, 30_000);
    document.addEventListener('visibilitychange', syncIfActive);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', syncIfActive);
    };
  }, [autoMineSessionConfirmed, confirmAutoMine, profile?.autoMineDeadlineAt]);

  useEffect(() => {
    if (!wallet?.account.address || !profile || profile.walletAddress === wallet.account.address) return;
    api<{ profile: Profile }>('/api/wallet', { method: 'POST', body: JSON.stringify({ address: wallet.account.address }) })
      .then((r) => applyServerProfile(r.profile))
      .catch((e) => setError(friendlyError(e, 'اتصال کیف پول انجام نشد.')));
  }, [wallet?.account.address, profile?.walletAddress]);

  const doProfileAction = async (path: string, fallback: string, after?: (result: any) => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await flush();
      const result = await api<any>(path, { method: 'POST' });
      if (result.profile) applyServerProfile(result.profile);
      after?.(result);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) {
      setError(friendlyError(e, fallback));
    } finally { setBusy(false); }
  };

  const claimDaily = () => doProfileAction('/api/daily', 'جایزه روزانه دریافت نشد.', (r) => setFlash(`🔥 روز ${nf.format(r.streakDay)} · +${nf.format(r.reward)} امتیاز`));
  const upgradeTapPower = () => doProfileAction('/api/upgrades/tap-power', 'ارتقا انجام نشد');
  const upgradeAutoMine = () => doProfileAction('/api/upgrades/auto-mine', 'ارتقای ماین خودکار انجام نشد', () => setAutoMineSessionConfirmed(true));
  const activateTurbo = () => doProfileAction('/api/upgrades/turbo', 'فعال‌سازی توربو انجام نشد');
  const activateAutoBooster = () => doProfileAction('/api/boosters/auto-mine', 'تقویت ماین فعال نشد.', () => { setAutoMineSessionConfirmed(true); setFlash('⚡ سرعت ماین ×۲ فعال شد'); });
  const buyShield = () => doProfileAction('/api/shop/mining-shield', 'خرید محافظ انجام نشد.', () => setFlash('🛡️ محافظ ماین اضافه شد'));
  const claimChest = () => doProfileAction('/api/chest/claim', 'بازکردن صندوق انجام نشد', (r) => { setFlash(`🎁 ${r.reward.label}`); void load(); });

  const prestige = async () => {
    if (!profile?.canPrestige || busy) return;
    if (!window.confirm('با ارتقای ویژه، امتیاز فعلی و ارتقاهای کلیک و ماین خودکار از نو شروع می‌شوند و در عوض ۵٪ پاداش دائمی می‌گیری. ادامه می‌دهی؟')) return;
    await doProfileAction('/api/prestige', 'ارتقای ویژه انجام نشد.', () => { setFlash('🌟 ارتقای ویژه انجام شد · +۵٪ پاداش دائمی'); void load(); });
  };

  const claimTask = async (taskId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; tasks: Task[] }>(`/api/tasks/${taskId}/claim`, { method: 'POST' });
      applyServerProfile(result.profile);
      setTasks(result.tasks);
    } catch (e) { setError(friendlyError(e, 'عملیات انجام نشد.')); }
    finally { setBusy(false); }
  };

  const claimChallenge = async (challengeId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; challenges: Challenge[]; reward: number }>(`/api/challenges/${challengeId}/claim`, { method: 'POST' });
      applyServerProfile(result.profile);
      setChallenges(result.challenges);
      setFlash(`✅ +${nf.format(result.reward)} امتیاز مأموریت`);
    } catch (e) { setError(friendlyError(e, 'عملیات انجام نشد.')); }
    finally { setBusy(false); }
  };

  const claimLeague = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; league: LeagueState; reward: number }>('/api/league/claim', { method: 'POST' });
      applyServerProfile(result.profile);
      setLeague(result.league);
      setFlash(`🏆 +${nf.format(result.reward)} امتیاز جایزه لیگ`);
    } catch (e) { setError(friendlyError(e, 'عملیات انجام نشد.')); }
    finally { setBusy(false); }
  };

  const selectSkin = (skinId: string) => doProfileAction(`/api/skins/${skinId}`, 'ظاهر سکه تغییر نکرد.', () => setFlash('🎨 ظاهر سکه تغییر کرد'));

  const copyInvite = async () => {
    if (!data?.inviteUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(data.inviteUrl);
    } catch {
      const area = document.createElement('textarea');
      area.value = data.inviteUrl;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    setFlash('🔗 لینک دعوت کپی شد');
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  };

  const shareInvite = () => {
    if (!data?.inviteUrl) return;
    const text = 'با لینک من وارد BlueTap شو و ۱۰۰ امتیاز شروع بگیر.';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(data.inviteUrl)}&text=${encodeURIComponent(text)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) window.Telegram.WebApp.openTelegramLink(shareUrl);
    else window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const levelProgress = useMemo(() => {
    if (!profile?.nextLevelPoints) return 100;
    return Math.min(100, Math.round((profile.totalEarned / profile.nextLevelPoints) * 100));
  }, [profile]);

  if (!telegramAccessAllowed) {
    return <main className="shell"><div className="loading-card"><b>ورود از تلگرام</b><p className="error">برای ورود به BlueTap، ربات رسمی BlueCoin را در تلگرام باز کن.</p><a className="primary" href="https://t.me/bluecoinxbot" target="_blank" rel="noreferrer">باز کردن @bluecoinxbot</a></div></main>;
  }
  if (!profile || !data || !league) {
    return <main className="shell"><div className="loading-card"><div className="spinner" /><b>BlueTap در حال بارگذاری…</b>{error && <p className="error">{error}</p>}</div></main>;
  }

  return (
    <main className="shell">
      <header className="topbar"><div><span className="eyebrow">{seasonLabel(data.season.name)}</span><h1>BlueTap</h1></div><div className="level-pill">سطح {nf.format(profile.level)} · {levelLabel(profile.name)}</div></header>
      {error && <button className="error-banner" onClick={() => setError(null)}>{error} ×</button>}
      {flash && <div className="feature-flash">{flash}</div>}

      <section className="content">
        {tab === 'mine' && <>
          <div className="balance-card"><span>امتیاز شما</span><strong>{nf.format(profile.points)}</strong><div className="level-track"><i style={{ width: `${levelProgress}%` }} /></div><div className="balance-meta"><small>کل استخراج {nf.format(profile.totalEarned)}</small><small>پاداش دائمی +{nf.format(profile.prestigeBonusPercent)}٪</small></div></div>
          {profile.event.active && <div className="event-banner">🌊 ساعت آبی · امتیاز ×{profile.event.tapMultiplier} · {durationLabel(eventRemainingSeconds)}</div>}
          {turboActive && <div className="turbo-banner">⚡ توربو ×{profile.turboMultiplier} فعال · {nf.format(turboRemainingSeconds)} ثانیه</div>}
          {profile.comboMultiplier > 1 && <div className="combo-banner">🔥 زنجیره ×{profile.comboMultiplier} · {nf.format(profile.comboCount)} ضربه</div>}

          <div className={`coin-stage skin-${profile.selectedSkin}${turboActive ? ' turbo-on' : ''}`}>
            <button className="coin" onPointerDown={tap} onContextMenu={(event) => event.preventDefault()} aria-label="Tap to mine"><span className="coin-ring"><b>B</b><small>BLUEX</small></span></button>
            <div className="tap-effects" aria-hidden="true">{floatingTaps.map((item) => <span className="floating-tap" key={item.id} style={{ left: `${item.x}px`, top: `${item.y}px` }}>+{item.value}</span>)}</div>
          </div>
          <p className="tap-hint">هر لمس +{nf.format(tapReward)} امتیاز · {nf.format(tapReward)} انرژی</p>

          <div className="energy-card"><div><span>⚡ انرژی</span><b>{nf.format(profile.energy)} / {nf.format(profile.maxEnergy)}</b></div><div className="energy-track"><i style={{ width: `${(profile.energy / profile.maxEnergy) * 100}%` }} /></div><div className="energy-meta"><small>بازیابی: +{nf.format(profile.energyRegenPerSecond)}/ثانیه</small><small>ضربه‌های شانسی: {nf.format(profile.luckyHits)}</small></div></div>

          <section className={`auto-mine-card${autoMineExpired ? ' expired' : autoMineSessionConfirmed ? ' active' : ''}`}>
            <div className="auto-mine-head"><div><span className="auto-mine-icon">🤖</span><b>ماین خودکار</b></div><span>سطح {nf.format(profile.autoMineLevel)}</span></div>
            <div className="auto-mine-stats"><div><small>سرعت</small><strong>+{nf.format(profile.autoMineRatePerMinute)} امتیاز/دقیقه</strong></div><div><small>{autoMineExpired ? 'در معرض سوختن' : 'استخراج معلق'}</small><strong>{nf.format(autoMineLivePending)} امتیاز</strong></div></div>
            {autoBoostActive && <div className="mini-boost">⚡ ×{profile.autoMineBoostMultiplier} فعال · {durationLabel(autoBoostRemainingSeconds)}</div>}
            <div className="auto-mine-deadline">{autoMineExpired ? <span>مهلت تأیید تمام شده؛ اگر محافظ نداشته باشی امتیازهای معلق از بین می‌روند.</span> : <span>مهلت تأیید: {durationLabel(autoMineRemainingSeconds)} دیگر</span>}<small>محافظ موجود: {nf.format(profile.miningShields)}</small></div>
            <button disabled={busy} onClick={() => void confirmAutoMine(true)}>{autoMineExpired ? 'تأیید و تعیین وضعیت' : autoMineSessionConfirmed ? 'تأیید الآن' : 'تأیید ماین خودکار'}</button>
            {profile.autoMineBurnedTotal > 0 && <small className="burned-total">از دست‌رفته: {nf.format(profile.autoMineBurnedTotal)} امتیاز</small>}
          </section>

          <section className={`chest-card${profile.chestReady ? ' ready' : ''}`}><div><span>🎁</span><b>صندوق جایزه</b><small>{profile.chestReady ? 'صندوق آماده است' : `آماده در ${durationLabel(chestRemainingSeconds)}`}</small></div><button disabled={!profile.chestReady || busy} onClick={claimChest}>{profile.chestReady ? 'باز کردن' : 'در انتظار'}</button></section>

          <div className="quick-grid">
            <button className="quick-card" onClick={() => setTab('boost')}><span>🚀</span><b>ارتقا و توربو</b><small>قدرت فعلی +{nf.format(profile.tapPower)}</small></button>
            <button className="quick-card" disabled={!profile.canClaimDaily || busy} onClick={claimDaily}><span>🔥</span><b>ورود روزانه</b><small>{profile.canClaimDaily ? `جایزه +${nf.format(profile.dailyNextReward)} امتیاز` : `زنجیره ${nf.format(profile.dailyStreak)} روزه`}</small></button>
            <button className="quick-card" onClick={() => setTab('friends')}><span>👥</span><b>دعوت دوستان</b><small>{nf.format(profile.referrals)} نفر</small></button>
            <button className="quick-card" onClick={() => setTab('tasks')}><span>🏆</span><b>لیگ {leagueLabel(league.current.name)}</b><small>{nf.format(league.current.points)} امتیاز هفتگی</small></button>
          </div>

          <section className="jackpot-card"><div className="section-title"><h2>جایزه بزرگ</h2><span>{nf.format(data.jackpot.pool)} امتیاز</span></div><p>جایزه فعلی از بخشی از خریدهای ارتقا ساخته می‌شود. قرعه بعدی: {durationLabel(jackpotRemainingSeconds)}</p>{data.jackpot.lastWinner && <small>برنده قبلی: {data.jackpot.lastWinner.name} · +{nf.format(data.jackpot.lastWinner.amount)} امتیاز</small>}</section>

          <section className="mini-board"><div className="section-title"><h2>برترین‌های هفته</h2><span>{leagueLabel(league.current.name)}</span></div>{data.weeklyLeaderboard.slice(0, 5).map((leader, index) => <div className="leader" key={leader.telegram_id}><span className="rank">{index + 1}</span><b>{leader.username ? `@${leader.username}` : leader.first_name}</b><strong>{nf.format(leader.points)}</strong></div>)}</section>
        </>}

        {tab === 'boost' && <section className="panel boost-panel">
          <div className="section-title"><h2>ارتقا و فروشگاه</h2><span>{nf.format(profile.points)} امتیاز</span></div>
          <article className="upgrade-card"><div className="upgrade-icon">🔋</div><div className="upgrade-copy"><b>مزایای سطح {nf.format(profile.level)}</b><strong>{nf.format(profile.maxEnergy)} <small>سقف انرژی · +{nf.format(profile.energyRegenPerSecond)}/ثانیه</small></strong><p>{profile.nextMaxEnergy ? `سطح بعد سقف انرژی را به ${nf.format(profile.nextMaxEnergy)} می‌رساند.` : 'بالاترین سطح انرژی فعال است.'}</p></div></article>
          <article className="upgrade-card auto-upgrade-card"><div className="upgrade-icon">🤖</div><div className="upgrade-copy"><b>سرعت ماین خودکار</b><strong>+{nf.format(profile.autoMineRatePerMinute)} <small>امتیاز/دقیقه · سطح {nf.format(profile.autoMineLevel)}</small></strong><p>با هر ارتقا، سرعت ماین خودکار بیشتر می‌شود.</p></div>{profile.autoMineUpgradeCost === null ? <button disabled>بیشترین سطح</button> : <button disabled={busy || profile.points < profile.autoMineUpgradeCost} onClick={upgradeAutoMine}>ارتقا · {nf.format(profile.autoMineUpgradeCost)} امتیاز</button>}</article>
          <article className="upgrade-card"><div className="upgrade-icon">👆</div><div className="upgrade-copy"><b>قدرت هر کلیک</b><strong>+{nf.format(profile.tapPower)} <small>برای هر لمس</small></strong><p>با هر ارتقا، امتیاز و مصرف انرژی هر لمس بیشتر می‌شود.</p></div>{profile.tapPowerUpgradeCost === null ? <button disabled>بیشترین سطح</button> : <button disabled={busy || profile.points < profile.tapPowerUpgradeCost} onClick={upgradeTapPower}>ارتقا به +{nf.format(profile.tapPower + 1)} · {nf.format(profile.tapPowerUpgradeCost)} امتیاز</button>}</article>
          <article className={`upgrade-card turbo-card${turboActive ? ' active' : ''}`}><div className="upgrade-icon">⚡</div><div className="upgrade-copy"><b>توربو ×{profile.turboMultiplier}</b><strong>{turboActive ? durationLabel(turboRemainingSeconds) : `${nf.format(profile.turboDurationSeconds)} ثانیه`}</strong><p>قدرت هر لمس را برای مدت کوتاه چندبرابر می‌کند.</p></div><button disabled={busy || turboActive || profile.points < profile.turboCost} onClick={activateTurbo}>{turboActive ? 'توربو فعال است' : `فعال‌سازی · ${nf.format(profile.turboCost)} امتیاز`}</button></article>
          <article className={`upgrade-card booster-card${autoBoostActive ? ' active' : ''}`}><div className="upgrade-icon">🚀</div><div className="upgrade-copy"><b>تقویت ماین ×{profile.autoMineBoostMultiplier}</b><strong>{autoBoostActive ? durationLabel(autoBoostRemainingSeconds) : `${nf.format(profile.autoMineBoostDurationSeconds / 60)} دقیقه`}</strong><p>سرعت ماین خودکار را برای مدتی دوبرابر می‌کند.</p></div><button disabled={busy || profile.points < profile.autoMineBoostCost} onClick={activateAutoBooster}>فعال‌سازی · {nf.format(profile.autoMineBoostCost)} امتیاز</button></article>
          <article className="upgrade-card shield-card"><div className="upgrade-icon">🛡️</div><div className="upgrade-copy"><b>محافظ ماین</b><strong>{nf.format(profile.miningShields)} / {nf.format(profile.maxMiningShields)}</strong><p>اگر تأیید را از دست بدهی، یک محافظ از امتیازهای معلق نگهداری می‌کند.</p></div><button disabled={busy || profile.miningShields >= profile.maxMiningShields || profile.points < profile.miningShieldCost} onClick={buyShield}>خرید · {nf.format(profile.miningShieldCost)} امتیاز</button></article>
          <article className={`upgrade-card prestige-card${profile.canPrestige ? ' ready' : ''}`}><div className="upgrade-icon">🌟</div><div className="upgrade-copy"><b>ارتقای ویژه {nf.format(profile.prestigeLevel)}</b><strong>+{nf.format(profile.prestigeBonusPercent)}% <small>پاداش دائمی ماین</small></strong><p>نیاز: {nf.format(profile.prestigeRequirement)} کل استخراج. امتیاز و ارتقاها از نو شروع می‌شوند و ۵٪ پاداش دائمی می‌گیری.</p></div><button disabled={busy || !profile.canPrestige} onClick={prestige}>{profile.canPrestige ? 'ارتقای ویژه' : 'هنوز قفل است'}</button></article>
          <div className="skins-title"><b>🎨 ظاهر سکه</b><small>فقط ظاهر سکه را تغییر می‌دهد</small></div>
          <div className="skins-grid">{data.skins.map((skin) => { const unlocked = profile.unlockedSkins.includes(skin.id); const selected = profile.selectedSkin === skin.id; return <button key={skin.id} className={`skin-card${selected ? ' selected' : ''}`} disabled={busy || selected || (!unlocked && profile.points < skin.cost)} onClick={() => selectSkin(skin.id)}><span>{skin.icon}</span><b>{skinLabel(skin.name)}</b><small>{selected ? 'فعال' : unlocked ? 'انتخاب' : `${nf.format(skin.cost)} امتیاز`}</small></button>; })}</div>
        </section>}

        {tab === 'tasks' && <section className="panel">
          <div className="section-title"><h2>ماموریت‌ها و لیگ</h2><span>{leagueLabel(league.current.name)}</span></div>
          <div className="league-card"><div><small>لیگ این هفته</small><strong>{leagueLabel(league.current.name)}</strong><span>{nf.format(league.current.points)} امتیاز</span></div>{league.current.nextMin ? <p>برای {leagueLabel(league.current.nextName)}: {nf.format(Math.max(0, league.current.nextMin - league.current.points))} امتیاز دیگر</p> : <p>بالاترین لیگ فعال است.</p>}{league.previous.claimable && <button disabled={busy} onClick={claimLeague}>دریافت جایزه هفته قبل · {nf.format(league.previous.reward)} امتیاز</button>}</div>
          <h3 className="subheading">روزانه</h3>
          {challenges.filter((item) => item.period === 'daily').map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimChallenge(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'در حال انجام'}</button></article>)}
          <h3 className="subheading">هفتگی</h3>
          {challenges.filter((item) => item.period === 'weekly').map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimChallenge(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'در حال انجام'}</button></article>)}
          <h3 className="subheading">دستاوردهای اصلی</h3>
          {tasks.map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimTask(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'در حال انجام'}</button></article>)}
        </section>}

        {tab === 'friends' && <section className="panel friends"><div className="hero-icon">👥</div><h2>دوستانت را دعوت کن</h2><p>برای هر دعوت موفق ۵۰۰ امتیاز می‌گیری و دوستت ۱۰۰ امتیاز شروع دریافت می‌کند.</p><div className="stat"><span>دعوت‌های موفق</span><strong>{nf.format(profile.referrals)}</strong></div>{data.inviteUrl ? <><div className="friend-actions"><button className="primary" onClick={shareInvite}>دعوت در تلگرام</button><button className="secondary-action" onClick={copyInvite}>کپی لینک</button></div><code>{data.inviteUrl}</code><small className="friends-refresh-note">تعداد دعوت‌های موفق به‌صورت خودکار به‌روز می‌شود.</small></> : <p className="notice">لینک دعوت فعلاً در دسترس نیست.</p>}</section>}
        {tab === 'wallet' && <section className="panel wallet-panel"><div className="hero-icon">💎</div><h2>کیف پول TON</h2><p>کیف پول TON را متصل کن تا برای دریافت پاداش‌های آینده آماده باشی.</p><TonConnectButton />{profile.walletAddress && <div className="wallet-address"><span>کیف پول ثبت‌شده</span><code>{shortAddress(profile.walletAddress)}</code></div>}<div className="token-box"><span>توکن بازی</span><b>BlueCoin · BLUEX</b><small>دریافت توکن هنوز فعال نشده است</small></div><button className="claim-locked" disabled>🔒 دریافت BLUEX — به‌زودی</button></section>}
      </section>

      <nav className="bottom-nav">
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}><span>◉</span>استخراج</button>
        <button className={tab === 'boost' ? 'active' : ''} onClick={() => setTab('boost')}><span>⚡</span>ارتقا</button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><span>✓</span>ماموریت‌ها</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><span>♧</span>دوستان</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}><span>◇</span>کیف پول</button>
      </nav>
    </main>
  );
}
