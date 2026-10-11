import { existsSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from 'node:util';
import type { Plugin } from 'vite';

/** Must match COACH_ENDPOINT in src/coach/client.ts (checked by a test). */
export const COACH_ROUTE = '/api/coach';
/** Must match IMPORT_NOTATION_ENDPOINT in src/import/notation.ts (checked by a test). */
export const IMPORT_NOTATION_ROUTE = '/api/import-notation';

export interface CoachEnv {
  apiKey?: string | undefined;
  model?: string | undefined;
  /** IMPORT_MODEL: the model that reads notation images. */
  importModel?: string | undefined;
}

/**
 * Variables from the project's .env file only, not the shell environment, so the coach uses a
 * key only when the player put one in .env. Missing file: empty.
 */
export function readDotEnv(path = '.env'): CoachEnv {
  if (!existsSync(path)) return {};
  const env = parseEnv(readFileSync(path, 'utf8'));
  return {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.COACH_MODEL,
    ...(env.IMPORT_MODEL !== undefined ? { importModel: env.IMPORT_MODEL } : {}),
  };
}

/**
 * Dev-server routes: POST /api/coach and GET/POST /api/import-notation. The API key stays in this Node process and never reaches
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
      server.middlewares.use(IMPORT_NOTATION_ROUTE, (req: IncomingMessage, res: ServerResponse) => {
        void server
          .ssrLoadModule('/server/importRoute.ts')
          .then((route) => route.handleImportNotation(req, res, { apiKey: env.apiKey, model: env.importModel }))
          .catch((error: unknown) => {
            console.error('[import]', error);
            res.statusCode = 500;
            res.end();
          });
      });
    },
  };
}
