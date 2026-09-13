export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { user?: { first_name?: string }; start_param?: string };
        ready(): void;
        expand(): void;
        HapticFeedback?: { impactOccurred(style: 'light' | 'medium' | 'heavy'): void; notificationOccurred(type: 'success' | 'error' | 'warning'): void };
        openTelegramLink?(url: string): void;
      };
    };
  }
}
