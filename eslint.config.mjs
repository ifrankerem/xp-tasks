import { FlatCompat } from '@eslint/eslintrc'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
})

const config = [
  {
    // `worker/` is a separate Cloudflare Workers package with its own tsconfig.
    // `android/` holds Gradle output and the copied web bundle; `design/` holds one-off Node scripts.
    ignores: ['.next/**', 'out/**', 'web/dist/**', 'node_modules/**', 'next-env.d.ts', 'worker/**', 'android/**', 'design/**'],
  },
  ...compat.config({
    extends: ['next/core-web-vitals', 'next/typescript'],
  }),
  {
    rules: {
      // Task photos are data URLs and the static export disables image optimization.
      '@next/next/no-img-element': 'off',
    },
  },
]

export default config
