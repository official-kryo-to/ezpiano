import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'forks', // onnxruntime-web spawns its own worker threads
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
