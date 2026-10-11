import { describe, expect, it } from 'vitest';
import { fitWithin, notationImportAvailable, requestNotationImport } from './client';
import { IMPORT_NOTATION_ENDPOINT } from './notation';

const image = { mediaType: 'image/png' as const, data: 'AAAA' };
const reply = { title: 't', bpm: 80, beatsPerBar: 4, grid: 'sixteenth', text: 'SN: x---------------', confidence: 'high', notes: '' };
const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('fitWithin', () => {
  it('downscales the long edge to 1568 px, keeping the aspect ratio, and never scales up', () => {
    expect(fitWithin(3136, 1000)).toEqual({ width: 1568, height: 500, scaled: true });
    expect(fitWithin(1000, 4704)).toEqual({ width: 333, height: 1568, scaled: true });
    expect(fitWithin(1568, 900)).toEqual({ width: 1568, height: 900, scaled: false });
    expect(fitWithin(400, 300)).toEqual({ width: 400, height: 300, scaled: false });
  });
});

describe('notation client', () => {
  it('posts the image to the endpoint and passes a good reply on', async () => {
    let sent: { url: string; body: string } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent = { url, body: String(init.body) };
      return new Response(JSON.stringify({ ok: true, reply, retried: true }));
    }) as unknown as typeof fetch;
    expect(await requestNotationImport(image, fetchFn)).toEqual({ ok: true, reply, retried: true });
    expect(sent!.url).toBe(IMPORT_NOTATION_ENDPOINT);
    expect(JSON.parse(sent!.body)).toEqual({ image });
  });

  it('passes failures on, keeping a fixable reply', async () => {
    expect(await requestNotationImport(image, answer({ ok: false, reason: 'parse-failed', message: 'Line 2', reply }))).toEqual({ ok: false, reason: 'parse-failed', message: 'Line 2', reply });
    expect(await requestNotationImport(image, answer({ ok: false, reason: 'no-key', message: '' }))).toMatchObject({ reason: 'no-key' });
  });

  it('a missing server, junk, or a network error never throws', async () => {
    expect(await requestNotationImport(image, answer('nope', 404))).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await requestNotationImport(image, answer({ ok: true, reply: { title: 1 } }))).toMatchObject({ ok: false, reason: 'invalid-response' });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await requestNotationImport(image, down)).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(await notationImportAvailable(down)).toBe(false);
  });

  it('availability follows the server', async () => {
    expect(await notationImportAvailable(answer({ available: true }))).toBe(true);
    expect(await notationImportAvailable(answer({ available: false }))).toBe(false);
    expect(await notationImportAvailable(answer('x', 404))).toBe(false);
  });
});
