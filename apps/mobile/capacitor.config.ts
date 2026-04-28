import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trainticket.app',
  appName: 'TrainTicket',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
