import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IMPORT_NOTATION_ENDPOINT, notationDraft, type NotationReply } from '../src/import/notation';
import { draftToLesson } from '../src/import/draft';
import { DEFAULT_IMPORT_MODEL, IMPORT_SYSTEM_PROMPT, importNotation } from './importNotation';
import { IMPORT_NOTATION_ROUTE, readDotEnv } from './coachPlugin';
import { handleImportNotation } from './importRoute';

// The SDK is mocked: no real API calls in tests.
const sdk = vi.hoisted(() => ({ create: vi.fn(), constructed: [] as unknown[] }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
    static APIUserAbortError = actual.default.APIUserAbortError;
    static APIError = actual.default.APIError;
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const image = { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' };
const good: NotationReply = {
  title: '16th tom fill',
  bpm: 85,
  beatsPerBar: 4,
  grid: 'sixteenth',
  text: 'SN: ----x-------xxxx\nT1: ----------------\nKK: x-------x-------',
  confidence: 'medium',
  notes: "Couldn't tell if beat 4 is snare or tom 1.",
};
const broken: NotationReply = { ...good, text: 'SN: ----x-------xxxx\nKK: x-------x---' };
const reply = (r: unknown, stop_reason = 'end_turn') => ({ content: [{ type: 'text', text: JSON.stringify(r) }], stop_reason });

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
});

describe('importNotation', () => {
  it('valid response: the reply comes back; image, system prompt, model and schema are sent', async () => {
    sdk.create.mockResolvedValue(reply(good));
    expect(await importNotation(image, { apiKey: 'k' })).toEqual({ ok: true, reply: good, retried: false });
    const [params, options] = sdk.create.mock.calls[0]!;
    expect(params.model).toBe(DEFAULT_IMPORT_MODEL);
    expect(DEFAULT_IMPORT_MODEL).toBe('claude-sonnet-5-5');
    expect(params.system).toBe(IMPORT_SYSTEM_PROMPT);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.data } });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(sdk.constructed).toEqual([{ apiKey: 'k', maxRetries: 0, timeout: 30_000 }]);
  });

  it('IMPORT_MODEL picks the model', async () => {
    sdk.create.mockResolvedValue(reply(good));
    await importNotation(image, { apiKey: 'k', model: 'claude-opus-5-5' });
    expect(sdk.create.mock.calls[0]![0].model).toBe('claude-opus-5-5');
  });

  it('text that fails to parse goes back to Claude once with the parse error, and the fix is used', async () => {
    const first = reply(broken);
    sdk.create.mockResolvedValueOnce(first).mockResolvedValueOnce(reply(good));
    expect(await importNotation(image, { apiKey: 'k' })).toEqual({ ok: true, reply: good, retried: true });
    expect(sdk.create).toHaveBeenCalledTimes(2);
    const messages = sdk.create.mock.calls[1]![0].messages;
    expect(messages).toHaveLength(3);
    // The first reply is passed back unchanged, then the parser's own error (with its line number).
    expect(messages[1]).toEqual({ role: 'assistant', content: first.content });
    expect(messages[2].content).toContain('Line 2 (KK) has 12 steps');
  });

  it('failing twice returns the parse error and the last reply, so the text can be fixed by hand', async () => {
    sdk.create.mockResolvedValue(reply(broken));
    const res = await importNotation(image, { apiKey: 'k' });
    expect(res).toMatchObject({ ok: false, reason: 'parse-failed', reply: broken });
    expect(res.ok === false && res.message).toContain('Line 2 (KK)');
    expect(sdk.create).toHaveBeenCalledTimes(2);
  });

  it('a reply of the wrong shape, a refusal, or a cut-off reply is invalid', async () => {
    for (const r of [reply({ ...good, extra: 1 }), reply({ ...good, grid: 'eighth' }), reply(good, 'refusal'), reply(good, 'max_tokens')]) {
      sdk.create.mockResolvedValueOnce(r);
      expect(await importNotation(image, { apiKey: 'k' })).toMatchObject({ ok: false, reason: 'invalid-response' });
    }
  });

  it('timeout: gives up and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    sdk.create.mockImplementation((_params, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const started = Date.now();
    expect(await importNotation(image, { apiKey: 'k', timeoutMs: 50 })).toMatchObject({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal?.aborted).toBe(true);
  });

  it('no key: a clear failure without calling the API', async () => {
    for (const apiKey of [undefined, '', '  ']) expect(await importNotation(image, { apiKey })).toMatchObject({ ok: false, reason: 'no-key' });
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.constructed).toEqual([]);
  });

  it('a good reply becomes a fill draft with the confidence and notes to check', () => {
    const draft = notationDraft(good);
    expect(draft).toMatchObject({ origin: 'image', bpm: 85, confidence: 'medium', uncertain: good.notes, landing: false });
    expect(draftToLesson(draft, 'my-i').data).toMatchObject({ kind: 'fill', origin: 'image', bars: 1 });
    expect(notationDraft({ ...good, bpm: 0 }).bpm).toBe(80);
  });
});

describe('/api/import-notation', () => {
  function call(method: string, body: string, config = {}) {
    const req = Object.assign(Readable.from([Buffer.from(body)]), { method }) as unknown as IncomingMessage;
    const out = { status: 0, body: '' };
    const res = {
      statusCode: 0,
      setHeader() {},
      end(data: string) {
        out.status = res.statusCode;
        out.body = data;
      },
    };
    return handleImportNotation(req, res as unknown as ServerResponse, config).then(() => ({ status: out.status, json: JSON.parse(out.body) }));
  }

  it('the route matches the endpoint the browser calls', () => {
    expect(IMPORT_NOTATION_ROUTE).toBe(IMPORT_NOTATION_ENDPOINT);
  });

  it('GET says whether a key is configured', async () => {
    expect((await call('GET', '')).json).toEqual({ available: false });
    expect((await call('GET', '', { apiKey: 'k' })).json).toEqual({ available: true });
  });

  it('POST without a key answers no-key', async () => {
    const { status, json } = await call('POST', JSON.stringify({ image }));
    expect(status).toBe(200);
    expect(json).toMatchObject({ ok: false, reason: 'no-key' });
  });

  it('rejects other methods and bad bodies', async () => {
    expect((await call('PUT', '')).status).toBe(405);
    expect((await call('POST', 'nope')).status).toBe(400);
    expect((await call('POST', JSON.stringify({ image: { mediaType: 'image/gif', data: 'AAAA' } }))).status).toBe(400);
    expect((await call('POST', JSON.stringify({ image: { mediaType: 'image/png', data: 'not base64!' } }))).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('IMPORT_MODEL is read from .env', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'drumly-env-'));
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-test\nIMPORT_MODEL=claude-opus-5-5\n');
    expect(readDotEnv(join(dir, '.env'))).toMatchObject({ apiKey: 'sk-test', importModel: 'claude-opus-5-5' });
  });
});
