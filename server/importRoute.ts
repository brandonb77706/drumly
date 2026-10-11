import type { IncomingMessage, ServerResponse } from 'node:http';
import { NOTATION_MEDIA_TYPES, type NotationMediaType } from '../src/import/notation';
import { readBody, send } from './coachRoute';
import { importNotation, type ImportConfig } from './importNotation';

/** A 1568 px image is at most a few MB; base64 adds a third. */
const MAX_BODY_BYTES = 12 * 1024 * 1024;

/**
 * GET: { available } (is a key configured?), so the page can say what's needed without nagging.
 * POST with { image: { mediaType, data } }: the transcription (see NotationImportResponse).
 */
export async function handleImportNotation(req: IncomingMessage, res: ServerResponse, config: ImportConfig): Promise<void> {
  if (req.method === 'GET') return send(res, 200, { available: Boolean(config.apiKey?.trim()) });
  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST only' });
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
  } catch {
    return send(res, 400, { ok: false, reason: 'bad-request', message: 'Body must be JSON under 12 MB' });
  }
  const image = typeof body === 'object' && body !== null ? (body as { image?: unknown }).image : undefined;
  const ok =
    typeof image === 'object' && image !== null &&
    (NOTATION_MEDIA_TYPES as readonly string[]).includes((image as { mediaType?: unknown }).mediaType as string) &&
    typeof (image as { data?: unknown }).data === 'string' &&
    /^[A-Za-z0-9+/]+=*$/.test((image as { data: string }).data);
  if (!ok) return send(res, 400, { ok: false, reason: 'bad-request', message: 'Expected { image: { mediaType: image/png | image/jpeg | image/webp, data: base64 } }' });
  const { mediaType, data } = image as { mediaType: NotationMediaType; data: string };
  send(res, 200, await importNotation({ mediaType, data }, config));
}
