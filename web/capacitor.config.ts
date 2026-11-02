import type { CapacitorConfig } from '@capacitor/cli'

// v2 packaging. The Android project is shared with v1 until the cutover, so it
// lives one level up; webDir is this app's Vite build.
const config: CapacitorConfig = {
  appId: 'com.ifrankerem.taskmanager',
  appName: 'Görevler',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: { path: '../android', allowMixedContent: false },
  plugins: {
    SystemBars: { insetsHandling: 'css', style: 'DARK' },
  },
}

export default config
