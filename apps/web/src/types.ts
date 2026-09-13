export interface Profile {
  id: string;
  firstName: string;
  username: string | null;
  points: number;
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

export interface Leader {
  telegram_id: string;
  username: string | null;
  first_name: string;
  points: number;
}

export interface Bootstrap {
  profile: Profile;
  tasks: Task[];
  leaderboard: Leader[];
  inviteUrl: string | null;
  token: { symbol: string; jettonMaster: string };
  season: { name: string; claimEnabled: boolean };
}
