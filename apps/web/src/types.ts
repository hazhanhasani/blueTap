export interface Profile {
  id: string;
  firstName: string;
  username: string | null;
  points: number;
  taps: number;
  energy: number;
  maxEnergy: number;
  referralCode: string;
  referrals: number;
  walletAddress: string | null;
  canClaimDaily: boolean;
  level: number;
  name: string;
  nextLevelPoints: number | null;
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
