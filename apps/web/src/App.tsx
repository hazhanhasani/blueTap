import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react';
import { api } from './api';
import type { Bootstrap, Profile, Task } from './types';

type Tab = 'mine' | 'boost' | 'tasks' | 'friends' | 'wallet';
type FloatingTap = { id: number; x: number; y: number; value: number };

const nf = new Intl.NumberFormat('fa-IR');

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tab, setTab] = useState<Tab>('mine');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [floatingTaps, setFloatingTaps] = useState<FloatingTap[]>([]);
  const [clock, setClock] = useState(Date.now());
  const pendingTaps = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const flushing = useRef(false);
  const tapVisualId = useRef(0);
  const energyRef = useRef(0);
  const wallet = useTonWallet();

  const telegramInitData = window.Telegram?.WebApp?.initData?.trim() || '';
  const allowDevAccess = Boolean(import.meta.env.VITE_DEV_TELEGRAM_ID);
  const telegramAccessAllowed = Boolean(telegramInitData) || allowDevAccess;

  const load = useCallback(async () => {
    if (!telegramAccessAllowed) return;
    try {
      const response = await api<Bootstrap>('/api/bootstrap');
      setData(response);
      setProfile(response.profile);
      setTasks(response.tasks);
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

  const flush = useCallback(async () => {
    if (flushing.current || pendingTaps.current <= 0) return;
    flushing.current = true;
    const count = Math.min(20, pendingTaps.current);
    pendingTaps.current -= count;
    try {
      const response = await api<{ awarded: number; awardedTaps: number; tapValue: number; energySpent: number; profile: Profile }>('/api/tap', {
        method: 'POST',
        body: JSON.stringify({ count }),
      });
      setProfile(response.profile);
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
      flush();
    }, 450);
  }, [flush]);

  const turboActive = Boolean(profile && profile.turboUntil > clock);
  const turboRemainingSeconds = profile && turboActive ? Math.max(0, Math.ceil((profile.turboUntil - clock) / 1000)) : 0;
  const tapReward = profile ? profile.tapPower * (turboActive ? profile.turboMultiplier : 1) : 1;

  const addFloatingTap = useCallback((x: number, y: number, value = 1) => {
    const id = ++tapVisualId.current;
    setFloatingTaps((prev) => [...prev.slice(-39), { id, x, y, value }]);
    window.setTimeout(() => {
      setFloatingTaps((prev) => prev.filter((item) => item.id !== id));
    }, 760);
  }, []);

  const tap = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!profile || energyRef.current < tapReward) return;

    energyRef.current -= tapReward;
    const rect = event.currentTarget.getBoundingClientRect();
    addFloatingTap(event.clientX - rect.left, event.clientY - rect.top, tapReward);

    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(turboActive ? 'medium' : 'light');
    pendingTaps.current += 1;
    setProfile((p) => p ? {
      ...p,
      points: p.points + tapReward,
      totalEarned: p.totalEarned + tapReward,
      taps: p.taps + 1,
      energy: Math.max(0, p.energy - tapReward),
    } : p);
    scheduleFlush();
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setProfile((p) => p && p.energy < p.maxEnergy ? {
        ...p,
        energy: Math.min(p.maxEnergy, p.energy + p.energyRegenPerSecond),
      } : p);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!wallet?.account.address || !profile || profile.walletAddress === wallet.account.address) return;
    api<{ profile: Profile }>('/api/wallet', { method: 'POST', body: JSON.stringify({ address: wallet.account.address }) })
      .then((r) => setProfile(r.profile))
      .catch((e) => setError(e instanceof Error ? e.message : 'خطای اتصال کیف پول'));
  }, [wallet?.account.address, profile?.walletAddress]);

  const claimDaily = async () => {
    setBusy(true);
    try {
      const result = await api<{ profile: Profile }>('/api/daily', { method: 'POST' });
      setProfile(result.profile);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setBusy(false); }
  };

  const claimTask = async (taskId: string) => {
    setBusy(true);
    try {
      const result = await api<{ profile: Profile; tasks: Task[] }>(`/api/tasks/${taskId}/claim`, { method: 'POST' });
      setProfile(result.profile);
      setTasks(result.tasks);
    } catch (e) { setError(e instanceof Error ? e.message : 'خطا'); }
    finally { setBusy(false); }
  };

  const upgradeTapPower = async () => {
    if (!profile?.tapPowerUpgradeCost || busy) return;
    setBusy(true);
    try {
      await flush();
      const result = await api<{ profile: Profile }>('/api/upgrades/tap-power', { method: 'POST' });
      setProfile(result.profile);
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) { setError(e instanceof Error ? e.message : 'ارتقا انجام نشد'); }
    finally { setBusy(false); }
  };

  const activateTurbo = async () => {
    if (!profile || turboActive || busy) return;
    setBusy(true);
    try {
      await flush();
      const result = await api<{ profile: Profile }>('/api/upgrades/turbo', { method: 'POST' });
      setProfile(result.profile);
      setClock(Date.now());
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch (e) { setError(e instanceof Error ? e.message : 'فعال‌سازی توربو انجام نشد'); }
    finally { setBusy(false); }
  };

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
    return (
      <main className="shell">
        <div className="loading-card">
          <b>دسترسی فقط از طریق تلگرام</b>
          <p className="error">BlueTap فقط از داخل Mini App رسمی تلگرام قابل استفاده است.</p>
          <a className="primary" href="https://t.me/bluecoinxbot" target="_blank" rel="noreferrer">باز کردن @bluecoinxbot</a>
        </div>
      </main>
    );
  }

  if (!profile || !data) {
    return <main className="shell"><div className="loading-card"><div className="spinner" /><b>BlueTap در حال بارگذاری…</b>{error && <p className="error">{error}</p>}</div></main>;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div><span className="eyebrow">{data.season.name}</span><h1>BlueTap</h1></div>
        <div className="level-pill">Lv.{profile.level} · {profile.name}</div>
      </header>

      {error && <button className="error-banner" onClick={() => setError(null)}>{error} ×</button>}

      <section className="content">
        {tab === 'mine' && <>
          <div className="balance-card">
            <span>Blue Points</span>
            <strong>{nf.format(profile.points)}</strong>
            <div className="level-track"><i style={{ width: `${levelProgress}%` }} /></div>
            <small>کل استخراج: {nf.format(profile.totalEarned)} · قدرت هر لمس: +{nf.format(tapReward)}</small>
          </div>

          {turboActive && <div className="turbo-banner">⚡ توربو ×{profile.turboMultiplier} فعال · {nf.format(turboRemainingSeconds)} ثانیه</div>}

          <div className={`coin-stage${turboActive ? ' turbo-on' : ''}`}>
            <button
              className="coin"
              onPointerDown={tap}
              onContextMenu={(event) => event.preventDefault()}
              aria-label="Tap to mine"
            >
              <span className="coin-ring"><b>B</b><small>BLUEX</small></span>
            </button>
            <div className="tap-effects" aria-hidden="true">
              {floatingTaps.map((item) => (
                <span
                  className="floating-tap"
                  key={item.id}
                  style={{ left: `${item.x}px`, top: `${item.y}px` }}
                >
                  +{item.value}
                </span>
              ))}
            </div>
          </div>
          <p className="tap-hint">هر لمس +{nf.format(tapReward)} امتیاز · -{nf.format(tapReward)} انرژی · چندلمسی فعال</p>

          <div className="energy-card">
            <div><span>⚡ انرژی</span><b>{nf.format(profile.energy)} / {nf.format(profile.maxEnergy)}</b></div>
            <div className="energy-track"><i style={{ width: `${(profile.energy / profile.maxEnergy) * 100}%` }} /></div>
            <div className="energy-meta">
              <small>بازیابی: +{nf.format(profile.energyRegenPerSecond)} انرژی در ثانیه</small>
              {profile.nextMaxEnergy ? (
                <small>سطح بعد: سقف {nf.format(profile.nextMaxEnergy)} · بازیابی +{nf.format(profile.nextEnergyRegenPerSecond || profile.energyRegenPerSecond)}/ثانیه</small>
              ) : (
                <small>بالاترین سطح انرژی فعال است</small>
              )}
            </div>
          </div>

          <div className="quick-grid">
            <button className="quick-card" onClick={() => setTab('boost')}>
              <span>🚀</span><b>ارتقا و توربو</b><small>قدرت فعلی +{nf.format(profile.tapPower)}</small>
            </button>
            <button className="quick-card" disabled={!profile.canClaimDaily || busy} onClick={claimDaily}>
              <span>🎁</span><b>جایزه روزانه</b><small>{profile.canClaimDaily ? '+۵۰۰ امتیاز' : 'دریافت شد'}</small>
            </button>
            <button className="quick-card" onClick={() => setTab('friends')}>
              <span>👥</span><b>دعوت دوستان</b><small>{nf.format(profile.referrals)} نفر</small>
            </button>
          </div>

          <section className="mini-board">
            <div className="section-title"><h2>برترین‌ها</h2><span>Top 10</span></div>
            {data.leaderboard.slice(0, 5).map((leader, index) => <div className="leader" key={leader.telegram_id}><span className="rank">{index + 1}</span><b>{leader.username ? `@${leader.username}` : leader.first_name}</b><strong>{nf.format(leader.points)}</strong></div>)}
          </section>
        </>}

        {tab === 'boost' && <section className="panel boost-panel">
          <div className="section-title"><h2>ارتقا استخراج</h2><span>{nf.format(profile.points)} BP</span></div>

          <article className="upgrade-card">
            <div className="upgrade-icon">🔋</div>
            <div className="upgrade-copy">
              <b>مزایای سطح {nf.format(profile.level)}</b>
              <strong>{nf.format(profile.maxEnergy)} <small>سقف انرژی · +{nf.format(profile.energyRegenPerSecond)}/ثانیه</small></strong>
              <p>{profile.nextMaxEnergy ? `با رسیدن به سطح بعد، سقف انرژی به ${nf.format(profile.nextMaxEnergy)} می‌رسد و سرعت بازیابی هم بر اساس سطح جدید افزایش می‌یابد.` : 'به بالاترین سطح فعلی رسیده‌ای و بیشترین سقف انرژی فعال است.'}</p>
            </div>
          </article>

          <article className="upgrade-card">
            <div className="upgrade-icon">👆</div>
            <div className="upgrade-copy">
              <b>قدرت هر کلیک</b>
              <strong>+{nf.format(profile.tapPower)} <small>برای هر لمس</small></strong>
              <p>ارتقای دائمی؛ هر سطح یک امتیاز بیشتر به هر کلیک اضافه می‌کند و به همان میزان انرژی مصرف می‌شود.</p>
            </div>
            {profile.tapPowerUpgradeCost === null ? (
              <button disabled>بیشترین سطح</button>
            ) : (
              <button disabled={busy || profile.points < profile.tapPowerUpgradeCost} onClick={upgradeTapPower}>
                ارتقا به +{nf.format(profile.tapPower + 1)} · {nf.format(profile.tapPowerUpgradeCost)} BP
              </button>
            )}
          </article>

          <article className={`upgrade-card turbo-card${turboActive ? ' active' : ''}`}>
            <div className="upgrade-icon">⚡</div>
            <div className="upgrade-copy">
              <b>حالت توربو ×{profile.turboMultiplier}</b>
              <strong>{turboActive ? `${nf.format(turboRemainingSeconds)} ثانیه باقی‌مانده` : `${nf.format(profile.turboDurationSeconds)} ثانیه قدرت بیشتر`}</strong>
              <p>در زمان توربو، قدرت فعلی کلیک در ×{profile.turboMultiplier} ضرب می‌شود و مصرف انرژی هم برابر امتیاز هر لمس خواهد بود.</p>
            </div>
            <button disabled={busy || turboActive || profile.points < profile.turboCost} onClick={activateTurbo}>
              {turboActive ? 'توربو فعال است' : `فعال‌سازی · ${nf.format(profile.turboCost)} BP`}
            </button>
          </article>

          <p className="upgrade-note">هزینه ارتقا از موجودی Blue Points کم می‌شود، اما «کل استخراج»، سطح و رتبه تاریخی شما کم نمی‌شود.</p>
        </section>}

        {tab === 'tasks' && <section className="panel">
          <div className="section-title"><h2>ماموریت‌ها</h2><span>Blue Points</span></div>
          {tasks.map((task) => <article className="task" key={task.id}>
            <div className="task-copy"><b>{task.title}</b><small>پاداش: +{nf.format(task.reward)}</small><div className="task-track"><i style={{ width: `${Math.min(100, (task.progress / task.target) * 100)}%` }} /></div><em>{nf.format(task.progress)} / {nf.format(task.target)}</em></div>
            <button disabled={!task.completed || task.claimed || busy} onClick={() => claimTask(task.id)}>{task.claimed ? 'گرفته شد' : task.completed ? 'دریافت' : 'ادامه'}</button>
          </article>)}
        </section>}

        {tab === 'friends' && <section className="panel friends">
          <div className="hero-icon">👥</div><h2>دوستانت را دعوت کن</h2><p>برای هر دعوت موفق ۵۰۰ امتیاز می‌گیری و دوستت ۱۰۰ امتیاز شروع دریافت می‌کند.</p>
          <div className="stat"><span>دعوت‌های موفق</span><strong>{nf.format(profile.referrals)}</strong></div>
          {data.inviteUrl ? <><button className="primary" onClick={copyInvite}>کپی لینک دعوت</button><code>{data.inviteUrl}</code></> : <p className="notice">برای ساخت لینک، BOT_USERNAME را در Worker تنظیم کن.</p>}
        </section>}

        {tab === 'wallet' && <section className="panel wallet-panel">
          <div className="hero-icon">💎</div><h2>کیف پول TON</h2><p>کیف پول را برای Season 1 متصل کن. برداشت BLUEX تا نهایی‌شدن قوانین توزیع و TON Proof عمداً قفل است.</p>
          <TonConnectButton />
          {profile.walletAddress && <div className="wallet-address"><span>کیف پول ثبت‌شده</span><code>{shortAddress(profile.walletAddress)}</code></div>}
          <div className="token-box"><span>BlueCoin</span><b>BLUEX</b><small>{shortAddress(data.token.jettonMaster)}</small></div>
          <button className="claim-locked" disabled>🔒 Claim BLUEX — به‌زودی</button>
        </section>}
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
