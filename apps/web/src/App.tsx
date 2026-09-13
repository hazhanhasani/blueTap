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
      setError(e instanceof Error ? e.message : 'خطا در اتصال');
    }
  }, [telegramAccessAllowed]);

  useEffect(() => { load(); }, [load]);

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
      if (response.luckyHits > 0) setFlash(`🍀 Lucky Tap ×${nf.format(response.highestLuckyMultiplier)} · +${nf.format(response.luckyBonus)} BP`);
      else if (response.comboMultiplier > 1) setFlash(`🔥 Combo ×${nf.format(response.comboMultiplier)} · ${nf.format(response.comboCount)} ضربه`);
    } catch (e) {
      pendingTaps.current = 0;
      setError(e instanceof Error ? e.message : 'ثبت ضربه ناموفق بود');
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
      if (result.shieldUsed) setFlash(`🛡️ Mining Shield استفاده شد و ${nf.format(result.awarded)} BP نجات پیدا کرد`);
      else if (result.burned > 0) setError(`${nf.format(result.burned)} BP ماین خودکار به‌دلیل عبور از مهلت ۵ ساعته سوخت.`);
      else if (manual) setFlash(`🤖 +${nf.format(result.awarded)} BP از ماین خودکار`);
    } catch (e) {
      if (manual) setError(e instanceof Error ? e.message : 'تأیید ماین خودکار انجام نشد');
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
      .catch((e) => setError(e instanceof Error ? e.message : 'خطای اتصال کیف پول'));
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
      setError(e instanceof Error ? e.message : fallback);
    } finally { setBusy(false); }
  };

  const claimDaily = () => doProfileAction('/api/daily', 'خطا در جایزه روزانه', (r) => setFlash(`🔥 روز ${nf.format(r.streakDay)} زنجیره · +${nf.format(r.reward)} BP`));
  const upgradeTapPower = () => doProfileAction('/api/upgrades/tap-power', 'ارتقا انجام نشد');
  const upgradeAutoMine = () => doProfileAction('/api/upgrades/auto-mine', 'ارتقای ماین خودکار انجام نشد', () => setAutoMineSessionConfirmed(true));
  const activateTurbo = () => doProfileAction('/api/upgrades/turbo', 'فعال‌سازی توربو انجام نشد');
  const activateAutoBooster = () => doProfileAction('/api/boosters/auto-mine', 'فعال‌سازی Booster انجام نشد', () => { setAutoMineSessionConfirmed(true); setFlash('⚡ Auto Mine ×2 فعال شد'); });
  const buyShield = () => doProfileAction('/api/shop/mining-shield', 'خرید Shield انجام نشد', () => setFlash('🛡️ Mining Shield اضافه شد'));
  const claimChest = () => doProfileAction('/api/chest/claim', 'بازکردن صندوق انجام نشد', (r) => { setFlash(`🎁 ${r.reward.label}`); void load(); });

  const prestige = async () => {
    if (!profile?.canPrestige || busy) return;
    if (!window.confirm('Prestige موجودی BP، قدرت کلیک و سطح Auto Mine را ریست می‌کند و در عوض +۵٪ پاداش دائمی می‌دهد. ادامه می‌دهی؟')) return;
    await doProfileAction('/api/prestige', 'Prestige انجام نشد', () => { setFlash('🌟 Prestige انجام شد · +۵٪ پاداش دائمی'); void load(); });
  };

  const claimTask = async (taskId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; tasks: Task[] }>(`/api/tasks/${taskId}/claim`, { method: 'POST' });
      applyServerProfile(result.profile);
      setTasks(result.tasks);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setBusy(false); }
  };

  const claimChallenge = async (challengeId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; challenges: Challenge[]; reward: number }>(`/api/challenges/${challengeId}/claim`, { method: 'POST' });
      applyServerProfile(result.profile);
      setChallenges(result.challenges);
      setFlash(`✅ +${nf.format(result.reward)} BP مأموریت`);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setBusy(false); }
  };

  const claimLeague = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; league: LeagueState; reward: number }>('/api/league/claim', { method: 'POST' });
      applyServerProfile(result.profile);
      setLeague(result.league);
      setFlash(`🏆 +${nf.format(result.reward)} BP جایزه لیگ`);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setBusy(false); }
  };

  const selectSkin = (skinId: string) => doProfileAction(`/api/skins/${skinId}`, 'Skin اعمال نشد', () => setFlash('🎨 ظاهر سکه تغییر کرد'));

  const copyInvite = async () => {
    if (!data?.inviteUrl) return;
    await navigator.clipboard.writeText(data.inviteUrl);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  };

  const levelProgress = useMemo(() => {
    if (!profile?.nextLevelPoints) return 100;
    return Math.min(100, Math.round((profile.totalEarned / profile.nextLevelPoints) * 100));
  }, [profile]);

  if (!telegramAccessAllowed) {
    return <main className="shell"><div className="loading-card"><b>دسترسی فقط از طریق تلگرام</b><p className="error">BlueTap فقط از داخل Mini App رسمی تلگرام قابل استفاده است.</p><a className="primary" href="https://t.me/bluecoinxbot" target="_blank" rel="noreferrer">باز کردن @bluecoinxbot</a></div></main>;
  }
  if (!profile || !data || !league) {
    return <main className="shell"><div className="loading-card"><div className="spinner" /><b>BlueTap در حال بارگذاری…</b>{error && <p className="error">{error}</p>}</div></main>;
  }

  return (
    <main className="shell">
      <header className="topbar"><div><span className="eyebrow">{data.season.name}</span><h1>BlueTap</h1></div><div className="level-pill">Lv.{profile.level} · {profile.name}</div></header>
      {error && <button className="error-banner" onClick={() => setError(null)}>{error} ×</button>}
      {flash && <div className="feature-flash">{flash}</div>}

      <section className="content">
        {tab === 'mine' && <>
          <div className="balance-card"><span>Blue Points</span><strong>{nf.format(profile.points)}</strong><div className="level-track"><i style={{ width: `${levelProgress}%` }} /></div><small>کل استخراج: {nf.format(profile.totalEarned)} · Prestige: {nf.format(profile.prestigeLevel)} (+{nf.format(profile.prestigeBonusPercent)}%)</small></div>
          {profile.event.active && <div className="event-banner">🌊 {profile.event.name} · Tap ×{profile.event.tapMultiplier} · {durationLabel(eventRemainingSeconds)}</div>}
          {turboActive && <div className="turbo-banner">⚡ توربو ×{profile.turboMultiplier} فعال · {nf.format(turboRemainingSeconds)} ثانیه</div>}
          {profile.comboMultiplier > 1 && <div className="combo-banner">🔥 Combo ×{profile.comboMultiplier} · {nf.format(profile.comboCount)} ضربه</div>}

          <div className={`coin-stage skin-${profile.selectedSkin}${turboActive ? ' turbo-on' : ''}`}>
            <button className="coin" onPointerDown={tap} onContextMenu={(event) => event.preventDefault()} aria-label="Tap to mine"><span className="coin-ring"><b>B</b><small>BLUEX</small></span></button>
            <div className="tap-effects" aria-hidden="true">{floatingTaps.map((item) => <span className="floating-tap" key={item.id} style={{ left: `${item.x}px`, top: `${item.y}px` }}>+{item.value}</span>)}</div>
          </div>
          <p className="tap-hint">هر لمس پایه +{nf.format(tapReward)} · -{nf.format(tapReward)} انرژی · Combo و Lucky پاداش اضافه می‌دهند</p>

          <div className="energy-card"><div><span>⚡ انرژی</span><b>{nf.format(profile.energy)} / {nf.format(profile.maxEnergy)}</b></div><div className="energy-track"><i style={{ width: `${(profile.energy / profile.maxEnergy) * 100}%` }} /></div><div className="energy-meta"><small>بازیابی: +{nf.format(profile.energyRegenPerSecond)}/ثانیه</small><small>Lucky Tapها: {nf.format(profile.luckyHits)}</small></div></div>

          <section className={`auto-mine-card${autoMineExpired ? ' expired' : autoMineSessionConfirmed ? ' active' : ''}`}>
            <div className="auto-mine-head"><div><span className="auto-mine-icon">🤖</span><b>ماین خودکار</b></div><span>Lv.{nf.format(profile.autoMineLevel)}</span></div>
            <div className="auto-mine-stats"><div><small>سرعت</small><strong>+{nf.format(profile.autoMineRatePerMinute)} BP/دقیقه</strong></div><div><small>{autoMineExpired ? 'در معرض سوختن' : 'استخراج معلق'}</small><strong>{nf.format(autoMineLivePending)} BP</strong></div></div>
            {autoBoostActive && <div className="mini-boost">⚡ ×{profile.autoMineBoostMultiplier} فعال · {durationLabel(autoBoostRemainingSeconds)}</div>}
            <div className="auto-mine-deadline">{autoMineExpired ? <span>مهلت ۵ ساعته تمام شده؛ اگر Shield نداشته باشی خروجی معلق می‌سوزد.</span> : <span>مهلت تأیید: {durationLabel(autoMineRemainingSeconds)} دیگر</span>}<small>Mining Shield موجود: {nf.format(profile.miningShields)}</small></div>
            <button disabled={busy} onClick={() => void confirmAutoMine(true)}>{autoMineExpired ? 'تأیید و تعیین وضعیت' : autoMineSessionConfirmed ? 'تأیید الآن' : 'تأیید ماین خودکار'}</button>
            {profile.autoMineBurnedTotal > 0 && <small className="burned-total">مجموع سوخته: {nf.format(profile.autoMineBurnedTotal)} BP</small>}
          </section>

          <section className={`chest-card${profile.chestReady ? ' ready' : ''}`}><div><span>🎁</span><b>Blue Chest</b><small>{profile.chestReady ? 'صندوق آماده است' : `آماده در ${durationLabel(chestRemainingSeconds)}`}</small></div><button disabled={!profile.chestReady || busy} onClick={claimChest}>{profile.chestReady ? 'باز کردن' : 'در انتظار'}</button></section>

          <div className="quick-grid">
            <button className="quick-card" onClick={() => setTab('boost')}><span>🚀</span><b>ارتقا و توربو</b><small>قدرت فعلی +{nf.format(profile.tapPower)}</small></button>
            <button className="quick-card" disabled={!profile.canClaimDaily || busy} onClick={claimDaily}><span>🔥</span><b>Streak روزانه</b><small>{profile.canClaimDaily ? `روز بعد +${nf.format(profile.dailyNextReward)} BP` : `زنجیره ${nf.format(profile.dailyStreak)} روزه`}</small></button>
            <button className="quick-card" onClick={() => setTab('friends')}><span>👥</span><b>دعوت دوستان</b><small>{nf.format(profile.referrals)} نفر</small></button>
            <button className="quick-card" onClick={() => setTab('tasks')}><span>🏆</span><b>لیگ {league.current.name}</b><small>{nf.format(league.current.points)} امتیاز هفتگی</small></button>
          </div>

          <section className="jackpot-card"><div className="section-title"><h2>Jackpot جمعی</h2><span>{nf.format(data.jackpot.pool)} BP</span></div><p>{nf.format(data.jackpot.contributionPercent)}٪ خریدهای ارتقا وارد Jackpot می‌شود. قرعه بعدی: {durationLabel(jackpotRemainingSeconds)}</p>{data.jackpot.lastWinner && <small>برنده قبلی: {data.jackpot.lastWinner.name} · +{nf.format(data.jackpot.lastWinner.amount)} BP</small>}</section>

          <section className="mini-board"><div className="section-title"><h2>برترین‌های هفته</h2><span>{league.current.name}</span></div>{data.weeklyLeaderboard.slice(0, 5).map((leader, index) => <div className="leader" key={leader.telegram_id}><span className="rank">{index + 1}</span><b>{leader.username ? `@${leader.username}` : leader.first_name}</b><strong>{nf.format(leader.points)}</strong></div>)}</section>
        </>}

        {tab === 'boost' && <section className="panel boost-panel">
          <div className="section-title"><h2>ارتقا و فروشگاه</h2><span>{nf.format(profile.points)} BP</span></div>
          <article className="upgrade-card"><div className="upgrade-icon">🔋</div><div className="upgrade-copy"><b>مزایای سطح {nf.format(profile.level)}</b><strong>{nf.format(profile.maxEnergy)} <small>سقف انرژی · +{nf.format(profile.energyRegenPerSecond)}/ثانیه</small></strong><p>{profile.nextMaxEnergy ? `سطح بعد سقف انرژی را به ${nf.format(profile.nextMaxEnergy)} می‌رساند.` : 'بالاترین سطح انرژی فعال است.'}</p></div></article>
          <article className="upgrade-card auto-upgrade-card"><div className="upgrade-icon">🤖</div><div className="upgrade-copy"><b>سرعت ماین خودکار</b><strong>+{nf.format(profile.autoMineRatePerMinute)} <small>BP/دقیقه · Lv.{nf.format(profile.autoMineLevel)}</small></strong><p>داخل و خارج بازی فعال است و هر ۵ ساعت نیاز به تأیید دارد.</p></div>{profile.autoMineUpgradeCost === null ? <button disabled>بیشترین سطح</button> : <button disabled={busy || profile.points < profile.autoMineUpgradeCost} onClick={upgradeAutoMine}>ارتقا · {nf.format(profile.autoMineUpgradeCost)} BP</button>}</article>
          <article className="upgrade-card"><div className="upgrade-icon">👆</div><div className="upgrade-copy"><b>قدرت هر کلیک</b><strong>+{nf.format(profile.tapPower)} <small>برای هر لمس</small></strong><p>ارتقای دائمی قدرت Tap؛ مصرف انرژی پایه برابر قدرت کلیک است.</p></div>{profile.tapPowerUpgradeCost === null ? <button disabled>بیشترین سطح</button> : <button disabled={busy || profile.points < profile.tapPowerUpgradeCost} onClick={upgradeTapPower}>ارتقا به +{nf.format(profile.tapPower + 1)} · {nf.format(profile.tapPowerUpgradeCost)} BP</button>}</article>
          <article className={`upgrade-card turbo-card${turboActive ? ' active' : ''}`}><div className="upgrade-icon">⚡</div><div className="upgrade-copy"><b>Turbo ×{profile.turboMultiplier}</b><strong>{turboActive ? durationLabel(turboRemainingSeconds) : `${nf.format(profile.turboDurationSeconds)} ثانیه`}</strong><p>قدرت Tap را موقتاً چندبرابر می‌کند.</p></div><button disabled={busy || turboActive || profile.points < profile.turboCost} onClick={activateTurbo}>{turboActive ? 'توربو فعال است' : `فعال‌سازی · ${nf.format(profile.turboCost)} BP`}</button></article>
          <article className={`upgrade-card booster-card${autoBoostActive ? ' active' : ''}`}><div className="upgrade-icon">🚀</div><div className="upgrade-copy"><b>Auto Mine Booster ×{profile.autoMineBoostMultiplier}</b><strong>{autoBoostActive ? durationLabel(autoBoostRemainingSeconds) : `${nf.format(profile.autoMineBoostDurationSeconds / 60)} دقیقه`}</strong><p>سرعت ماین خودکار را دوبرابر می‌کند و زمان خریدها روی هم جمع می‌شود.</p></div><button disabled={busy || profile.points < profile.autoMineBoostCost} onClick={activateAutoBooster}>فعال‌سازی · {nf.format(profile.autoMineBoostCost)} BP</button></article>
          <article className="upgrade-card shield-card"><div className="upgrade-icon">🛡️</div><div className="upgrade-copy"><b>Mining Shield</b><strong>{nf.format(profile.miningShields)} / {nf.format(profile.maxMiningShields)}</strong><p>اگر مهلت ۵ ساعته را از دست بدهی، یک Shield خودکار مصرف می‌شود و BP معلق نمی‌سوزد.</p></div><button disabled={busy || profile.miningShields >= profile.maxMiningShields || profile.points < profile.miningShieldCost} onClick={buyShield}>خرید · {nf.format(profile.miningShieldCost)} BP</button></article>
          <article className={`upgrade-card prestige-card${profile.canPrestige ? ' ready' : ''}`}><div className="upgrade-icon">🌟</div><div className="upgrade-copy"><b>Prestige {nf.format(profile.prestigeLevel)}</b><strong>+{nf.format(profile.prestigeBonusPercent)}% <small>پاداش دائمی ماین</small></strong><p>نیاز: {nf.format(profile.prestigeRequirement)} کل استخراج. با Prestige، BP فعلی و ارتقای Tap/Auto Mine ریست می‌شود ولی +۵٪ پاداش دائمی می‌گیری.</p></div><button disabled={busy || !profile.canPrestige} onClick={prestige}>{profile.canPrestige ? 'Prestige الآن' : 'هنوز قفل است'}</button></article>
          <div className="skins-title"><b>🎨 ظاهر سکه</b><small>کاملاً تزئینی و بدون اثر روی درآمد</small></div>
          <div className="skins-grid">{data.skins.map((skin) => { const unlocked = profile.unlockedSkins.includes(skin.id); const selected = profile.selectedSkin === skin.id; return <button key={skin.id} className={`skin-card${selected ? ' selected' : ''}`} disabled={busy || selected || (!unlocked && profile.points < skin.cost)} onClick={() => selectSkin(skin.id)}><span>{skin.icon}</span><b>{skin.name}</b><small>{selected ? 'فعال' : unlocked ? 'انتخاب' : `${nf.format(skin.cost)} BP`}</small></button>; })}</div>
        </section>}

        {tab === 'tasks' && <section className="panel">
          <div className="section-title"><h2>ماموریت‌ها و لیگ</h2><span>{league.current.name}</span></div>
          <div className="league-card"><div><small>لیگ این هفته</small><strong>{league.current.name}</strong><span>{nf.format(league.current.points)} BP</span></div>{league.current.nextMin ? <p>برای {league.current.nextName}: {nf.format(Math.max(0, league.current.nextMin - league.current.points))} امتیاز دیگر</p> : <p>بالاترین لیگ فعال است.</p>}{league.previous.claimable && <button disabled={busy} onClick={claimLeague}>دریافت جایزه هفته قبل · {nf.format(league.previous.reward)} BP</button>}</div>
          <h3 className="subheading">روزانه</h3>
          {challenges.filter((item) => item.period === 'daily').map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimChallenge(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'ادامه'}</button></article>)}
          <h3 className="subheading">هفتگی</h3>
          {challenges.filter((item) => item.period === 'weekly').map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimChallenge(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'ادامه'}</button></article>)}
          <h3 className="subheading">دستاوردهای اصلی</h3>
          {tasks.map((task) => <article className="task" key={task.id}><div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div><button disabled={!task.completed || task.claimed || busy} onClick={() => claimTask(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'ادامه'}</button></article>)}
        </section>}

        {tab === 'friends' && <section className="panel friends"><div className="hero-icon">👥</div><h2>دوستانت را دعوت کن</h2><p>برای هر دعوت موفق ۵۰۰ امتیاز می‌گیری و دوستت ۱۰۰ امتیاز شروع دریافت می‌کند.</p><div className="stat"><span>دعوت‌های موفق</span><strong>{nf.format(profile.referrals)}</strong></div>{data.inviteUrl ? <><button className="primary" onClick={copyInvite}>کپی لینک دعوت</button><code>{data.inviteUrl}</code></> : <p className="notice">BOT_USERNAME در Worker تنظیم نشده است.</p>}</section>}
        {tab === 'wallet' && <section className="panel wallet-panel"><div className="hero-icon">💎</div><h2>کیف پول TON</h2><p>کیف پول را برای Season 1 متصل کن. برداشت BLUEX تا نهایی‌شدن قوانین توزیع و TON Proof قفل است.</p><TonConnectButton />{profile.walletAddress && <div className="wallet-address"><span>کیف پول ثبت‌شده</span><code>{shortAddress(profile.walletAddress)}</code></div>}<div className="token-box"><span>BlueCoin</span><b>BLUEX</b><small>{shortAddress(data.token.jettonMaster)}</small></div><button className="claim-locked" disabled>🔒 Claim BLUEX — به‌زودی</button></section>}
      </section>

      <nav className="bottom-nav">
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}><span>◉</span>استخراج</button>
        <button className={tab === 'boost' ? 'active' : ''} onClick={() => setTab('boost')}><span>⚡</span>ارتقا</button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><span>✓</span>ماموریت</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><span>♧</span>دوستان</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}><span>◇</span>کیف پول</button>
      </nav>
    </main>
  );
}
