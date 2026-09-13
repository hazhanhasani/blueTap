import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TonConnectButton, useTonWallet } from '@tonconnect/ui-react';
import { api } from './api';
import type { Bootstrap, Profile, Task } from './types';

type Tab = 'mine' | 'tasks' | 'friends' | 'wallet';

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
  const pendingTaps = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const flushing = useRef(false);
  const wallet = useTonWallet();

  const load = useCallback(async () => {
    try {
      const response = await api<Bootstrap>('/api/bootstrap');
      setData(response);
      setProfile(response.profile);
      setTasks(response.tasks);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطا در اتصال');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    if (flushing.current || pendingTaps.current <= 0) return;
    flushing.current = true;
    const count = Math.min(20, pendingTaps.current);
    pendingTaps.current -= count;
    try {
      const response = await api<{ awarded: number; profile: Profile }>('/api/tap', {
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

  const tap = () => {
    if (!profile || profile.energy <= 0) return;
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');
    pendingTaps.current += 1;
    setProfile((p) => p ? { ...p, points: p.points + 1, taps: p.taps + 1, energy: Math.max(0, p.energy - 1) } : p);
    scheduleFlush();
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      setProfile((p) => p && p.energy < p.maxEnergy ? { ...p, energy: Math.min(p.maxEnergy, p.energy + 1) } : p);
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

  const copyInvite = async () => {
    if (!data?.inviteUrl) return;
    await navigator.clipboard.writeText(data.inviteUrl);
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
  };

  const levelProgress = useMemo(() => {
    if (!profile?.nextLevelPoints) return 100;
    return Math.min(100, Math.round((profile.points / profile.nextLevelPoints) * 100));
  }, [profile]);

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
            <small>{profile.nextLevelPoints ? `تا سطح بعد: ${nf.format(Math.max(0, profile.nextLevelPoints - profile.points))}` : 'بالاترین سطح'}</small>
          </div>

          <button className="coin" onClick={tap} aria-label="Tap to mine">
            <span className="coin-ring"><b>B</b><small>BLUEX</small></span>
          </button>
          <p className="tap-hint">برای جمع‌کردن امتیاز ضربه بزن</p>

          <div className="energy-card">
            <div><span>⚡ انرژی</span><b>{nf.format(profile.energy)} / {nf.format(profile.maxEnergy)}</b></div>
            <div className="energy-track"><i style={{ width: `${(profile.energy / profile.maxEnergy) * 100}%` }} /></div>
          </div>

          <div className="quick-grid">
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
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}><span>✓</span>ماموریت</button>
        <button className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}><span>♧</span>دوستان</button>
        <button className={tab === 'wallet' ? 'active' : ''} onClick={() => setTab('wallet')}><span>◇</span>کیف پول</button>
      </nav>
    </main>
  );
}
