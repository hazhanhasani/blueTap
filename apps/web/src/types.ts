export interface Profile {
  id: string;
  firstName: string;
  username: string | null;
  points: number;
  updatedAt: number;
  totalEarned: number;
  taps: number;
  energy: number;
  maxEnergy: number;
  energyRegenPerSecond: number;
  nextMaxEnergy: number | null;
  nextEnergyRegenPerSecond: number | null;
  referralCode: string;
  referrals: number;
  walletAddress: string | null;
  canClaimDaily: boolean;
  dailyStreak: number;
  dailyNextReward: number;
  level: number;
  name: string;
  nextLevelPoints: number | null;
  tapPower: number;
  tapPowerLevel: number;
  tapPowerUpgradeCost: number | null;
  maxTapPower: number;
  turboActive: boolean;
  turboMultiplier: number;
  turboDurationSeconds: number;
  turboUntil: number;
  turboRemainingSeconds: number;
  turboCost: number;
  autoMineLevel: number;
  autoMineRatePerMinute: number;
  autoMineBaseRatePerMinute: number;
  autoMineUpgradeCost: number | null;
  maxAutoMineLevel: number;
  autoMineLastAt: number;
  autoMineConfirmedAt: number;
  autoMineDeadlineAt: number;
  autoMinePending: number;
  autoMineExpired: boolean;
  autoMineRemainingSeconds: number;
  autoMineConfirmWindowSeconds: number;
  autoMineBurnedTotal: number;
  autoMineBoostActive: boolean;
  autoMineBoostUntil: number;
  autoMineBoostRemainingSeconds: number;
  autoMineBoostMultiplier: number;
  autoMineBoostCost: number;
  autoMineBoostDurationSeconds: number;
  miningShields: number;
  miningShieldCost: number;
  maxMiningShields: number;
  prestigeLevel: number;
  prestigeBonusPercent: number;
  prestigeRequirement: number;
  canPrestige: boolean;
  comboCount: number;
  comboMultiplier: number;
  comboExpiresAt: number;
  luckyHits: number;
  chestReady: boolean;
  chestNextAt: number;
  chestRemainingSeconds: number;
  selectedSkin: string;
  unlockedSkins: string[];
  event: {
    active: boolean;
    name: string;
    tapMultiplier: number;
    endsAt: number | null;
    nextStartsAt: number;
  };
}

export interface Task {
  id: string;
  title: string;
  reward: number;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface Challenge extends Task {
  period: 'daily' | 'weekly';
  metric: string;
  periodKey: string;
}

export interface Leader {
  telegram_id: string;
  username: string | null;
  first_name: string;
  points: number;
}

export interface LeagueState {
  current: { id: string; name: string; points: number; nextMin: number | null; nextName: string | null };
  previous: { weekKey: string; id: string; name: string; points: number; reward: number; claimable: boolean; claimed: boolean };
}

export interface Skin {
  id: string;
  name: string;
  cost: number;
  icon: string;
}

export interface JackpotState {
  pool: number;
  nextDrawAt: number;
  lastWinner: { telegramId: string; name: string; amount: number; at: number } | null;
  contributionPercent: number;
}

export interface Bootstrap {
  profile: Profile;
  tasks: Task[];
  challenges: Challenge[];
  league: LeagueState;
  leaderboard: Leader[];
  weeklyLeaderboard: Leader[];
  skins: Skin[];
  jackpot: JackpotState;
  inviteUrl: string | null;
  token: { symbol: string; jettonMaster: string };
  season: { name: string; claimEnabled: boolean };
}
