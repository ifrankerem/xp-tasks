import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    // Day math is local-time; pin the zone the phone uses.
    env: { TZ: 'Europe/Istanbul' },
    setupFiles: ['fake-indexeddb/auto', './test/setup.ts'],
    testTimeout: 15_000,
  },
})
