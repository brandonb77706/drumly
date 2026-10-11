import { defineConfig } from 'vitest/config';
import { coachApi, readDotEnv } from './server/coachPlugin.ts';

export default defineConfig({
  // .env (git-ignored) is read into this Node process only. The key goes to the server
  // middleware, never to `define` or import.meta.env, so it can't end up in the browser bundle.
  plugins: [coachApi(readDotEnv())],
  // Browser storage (practice history, saved fills) belongs to the exact address, port included.
  // If Vite quietly moved to 5174 because 5173 was busy, all history would look gone, so it fails instead.
  server: {
    port: 5173,
    strictPort: true,
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
