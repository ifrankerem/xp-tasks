import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Day math is local-time; pin the zone the phone uses.
    env: { TZ: 'Europe/Istanbul' },
    setupFiles: ['fake-indexeddb/auto'],
  },
})
