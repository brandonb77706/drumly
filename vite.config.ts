import { defineConfig } from 'vitest/config';
import { coachApi, readDotEnv } from './server/coachPlugin.ts';

export default defineConfig({
  // .env (git-ignored) is read into this Node process only. The key goes to the server
  // middleware, never to `define` or import.meta.env, so it can't end up in the browser bundle.
  plugins: [coachApi(readDotEnv())],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
