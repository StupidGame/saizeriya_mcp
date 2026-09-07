import { defineConfig } from 'vite-plus'
import { fileURLToPath } from 'node:url'

const ignoredPaths = ['packages/server/assets/**', '**/.svelte-kit/**', '**/build/**', '**/dist/**']

export default defineConfig({
  test: {
    alias: [
      {
        find: '$lib',
        replacement: fileURLToPath(new URL('./apps/betterzeriya/src/lib', import.meta.url)),
      },
      {
        find: '$env/dynamic/private',
        replacement: fileURLToPath(new URL('./tests/fixtures/env.ts', import.meta.url)),
      },
      {
        find: /^saizeriya\.js$/,
        replacement: fileURLToPath(new URL('./packages/client/index.ts', import.meta.url)),
      },
    ],
  },
  fmt: {
    ignorePatterns: ignoredPaths,
    semi: false,
    singleQuote: true,
  },
  lint: {
    ignorePatterns: ignoredPaths,
  },
})
