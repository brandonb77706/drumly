import type { IncomingMessage, ServerResponse } from 'node:http';
import { isSessionReport } from '../src/coach';
import { coachReport, type CoachConfig } from './claudeCoach';

/** Biggest request body accepted (a report is ~2 KB). */
const MAX_BODY_BYTES = 32 * 1024;

/** POST /api/coach with { report }: Claude coaching, or the rule-based fallback. */
export async function handleCoach(req: IncomingMessage, res: ServerResponse, config: CoachConfig): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: 'Body must be JSON under 32 KB' });
  }
  const report = typeof body === 'object' && body !== null ? (body as { report?: unknown }).report : undefined;
  if (!isSessionReport(report)) return send(res, 400, { error: 'Missing or malformed report' });
  send(res, 200, await coachReport(report, config));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
