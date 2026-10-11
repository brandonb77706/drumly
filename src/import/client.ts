import {
  IMPORT_NOTATION_ENDPOINT,
  MAX_IMAGE_EDGE,
  NOTATION_MEDIA_TYPES,
  isNotationReply,
  type NotationFailure,
  type NotationImportResponse,
  type NotationMediaType,
} from './notation';

/** The server gives up after 30 s; allow a little more for the round trip (and the upload). */
export const IMPORT_CLIENT_TIMEOUT_MS = 40_000;

const FAILURES: readonly NotationFailure[] = ['no-key', 'timeout', 'parse-failed', 'invalid-response', 'api-rejected', 'bad-key', 'api-error', 'unreachable', 'bad-request'];

/** Whether image import can work: the dev server is there and has a key. Never throws. */
export async function notationImportAvailable(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn(IMPORT_NOTATION_ENDPOINT, { method: 'GET' });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && (body as { available?: unknown }).available === true;
  } catch {
    return false;
  }
}

/** Send an image for transcription. Always resolves, with a failure reason if anything went wrong. */
export async function requestNotationImport(
  image: { mediaType: NotationMediaType; data: string },
  fetchFn: typeof fetch = fetch,
  timeoutMs = IMPORT_CLIENT_TIMEOUT_MS,
): Promise<NotationImportResponse> {
  const controller = new AbortController();
  // A network timeout, not timing or sound, so a timer is fine here.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(IMPORT_NOTATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image }),
      signal: controller.signal,
    });
    const body: unknown = await res.json().catch(() => null);
    if (typeof body !== 'object' || body === null) return { ok: false, reason: res.ok ? 'invalid-response' : 'unreachable', message: '' };
    const o = body as Record<string, unknown>;
    if (o.ok === true && isNotationReply(o.reply)) return { ok: true, reply: o.reply, retried: o.retried === true };
    if (o.ok === false && FAILURES.includes(o.reason as NotationFailure)) {
      return {
        ok: false,
        reason: o.reason as NotationFailure,
        message: typeof o.message === 'string' ? o.message.slice(0, 500) : '',
        ...(isNotationReply(o.reply) ? { reply: o.reply } : {}),
      };
    }
    return { ok: false, reason: res.ok ? 'invalid-response' : 'unreachable', message: '' };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'unreachable', message: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Size that fits inside `maxEdge` on the long edge, keeping the aspect ratio. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width, height, scaled: false };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), scaled: true };
}

export function isNotationMediaType(type: string): type is NotationMediaType {
  return (NOTATION_MEDIA_TYPES as readonly string[]).includes(type);
}

/**
 * Browser only: an image file as base64 ready to send, downscaled to at most MAX_IMAGE_EDGE px on
 * the long edge. Throws if the file isn't a PNG, JPEG or WebP image the browser can decode.
 */
export async function prepareImage(file: Blob): Promise<{ mediaType: NotationMediaType; data: string; width: number; height: number }> {
  if (!isNotationMediaType(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  const bitmap = await createImageBitmap(file);
  const size = fitWithin(bitmap.width, bitmap.height);
  let blob: Blob = file;
  let mediaType: NotationMediaType = file.type;
  if (size.scaled) {
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available to resize the image.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    // Notation is line art: PNG stays sharp. Photos (JPEG) stay JPEG to keep the upload small.
    mediaType = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the image.'))), mediaType, 0.92));
  }
  bitmap.close();
  return { mediaType, data: await toBase64(blob), width: size.width, height: size.height };
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
