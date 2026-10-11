import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from 'node:util';
import type { Plugin } from 'vite';

/** Must match COACH_ENDPOINT in src/coach/client.ts (checked by a test). */
export const COACH_ROUTE = '/api/coach';

export interface CoachEnv {
  apiKey?: string | undefined;
  model?: string | undefined;
}

/**
 * Variables from the project's .env file only, not the shell environment, so the coach uses a
 * key only when the player put one in .env. Missing file: empty.
 */
export function readDotEnv(path = '.env'): CoachEnv {
  if (!existsSync(path)) return {};
  const env = parseEnv(readFileSync(path, 'utf8'));
  return { apiKey: env.ANTHROPIC_API_KEY, model: env.COACH_MODEL };
}

/**
 * Dev-server route: POST /api/coach. The API key stays in this Node process and never reaches
 * the browser bundle. The route module (and the SDK) load on the first request, through Vite.
 */
export function coachApi(env: CoachEnv): Plugin {
  return {
    name: 'drumly-coach-api',
    configureServer(server) {
      server.middlewares.use(COACH_ROUTE, (req: IncomingMessage, res: ServerResponse) => {
        void server
          .ssrLoadModule('/server/coachRoute.ts')
          .then((route) => route.handleCoach(req, res, env))
          .catch((error: unknown) => {
            console.error('[coach]', error);
            res.statusCode = 500;
            res.end();
          });
      });
    },
  };
}
