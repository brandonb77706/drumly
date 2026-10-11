import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FILL_LESSONS } from '../src/lessons';
import { buildSessionReport, ruleBasedCoaching } from '../src/coach';
import { scriptedPass } from '../src/coach/testSessions';
import { coachReport, DEFAULT_COACH_MODEL, SYSTEM_PROMPT } from './claudeCoach';
import { COACH_ENDPOINT } from '../src/coach';
import { COACH_ROUTE } from './coachPlugin';
import { handleCoach } from './coachRoute';

// The SDK is mocked: no real API calls in tests.
const sdk = vi.hoisted(() => ({ create: vi.fn(), constructed: [] as unknown[] }));
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  class FakeAnthropic {
    static APIConnectionTimeoutError = actual.default.APIConnectionTimeoutError;
    static APIUserAbortError = actual.default.APIUserAbortError;
    messages = { create: sdk.create };
    constructor(options: unknown) {
      sdk.constructed.push(options);
    }
  }
  return { ...actual, default: FakeAnthropic };
});

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const report = buildSessionReport({ lesson: toms, passes: [0, 1, 2].map((p) => scriptedPass(toms, p, 60)) });
const rules = ruleBasedCoaching(report);

const good = { headline: ' Clean fill at 60. ', wentWell: ['100% on the fill.'], fixThis: [], nextExercise: 'Try it at 65 BPM.' };
const reply = (text: string, stop_reason = 'end_turn') => ({ content: [{ type: 'text', text }], stop_reason });

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
});

describe('coachReport', () => {
  it('valid response: Claude coaching, with the report and system prompt sent', async () => {
    sdk.create.mockResolvedValue(reply(JSON.stringify(good)));
    const res = await coachReport(report, { apiKey: 'test-key' });
    expect(res).toEqual({ source: 'claude', coaching: { ...good, headline: 'Clean fill at 60.' } });

    expect(sdk.constructed).toEqual([{ apiKey: 'test-key', maxRetries: 0, timeout: 10_000 }]);
    const [params, options] = sdk.create.mock.calls[0]!;
    expect(params.model).toBe(DEFAULT_COACH_MODEL);
    expect(DEFAULT_COACH_MODEL).toBe('claude-haiku-5-5');
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.output_config.format.type).toBe('json_schema');
    expect(params.messages[0].content).toContain(JSON.stringify(report));
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('COACH_MODEL picks the model', async () => {
    sdk.create.mockResolvedValue(reply(JSON.stringify(good)));
    await coachReport(report, { apiKey: 'k', model: 'claude-sonnet-5-5' });
    expect(sdk.create.mock.calls[0]![0].model).toBe('claude-sonnet-5-5');
  });

  it('tolerates a ```json fence', async () => {
    sdk.create.mockResolvedValue(reply('```json\n' + JSON.stringify(good) + '\n```'));
    expect((await coachReport(report, { apiKey: 'k' })).source).toBe('claude');
  });

  it('invalid JSON falls back to rules', async () => {
    sdk.create.mockResolvedValue(reply('Great session! Keep it up.'));
    expect(await coachReport(report, { apiKey: 'k' })).toEqual({ source: 'rules', coaching: rules, reason: 'invalid-response' });
  });

  it('JSON of the wrong shape falls back to rules', async () => {
    for (const bad of [
      { ...good, extra: 'x' },
      { headline: 'Hi', wentWell: 'not a list', fixThis: [], nextExercise: 'x' },
      { headline: '', wentWell: [], fixThis: [], nextExercise: 'x' },
      { ...good, fixThis: ['a', 'b', 'c', 'd', 'e'] },
    ]) {
      sdk.create.mockResolvedValueOnce(reply(JSON.stringify(bad)));
      expect(await coachReport(report, { apiKey: 'k' })).toMatchObject({ source: 'rules', reason: 'invalid-response' });
    }
  });

  it('a refusal or a cut-off reply falls back to rules', async () => {
    sdk.create.mockResolvedValueOnce(reply(JSON.stringify(good), 'refusal'));
    expect((await coachReport(report, { apiKey: 'k' })).source).toBe('rules');
    sdk.create.mockResolvedValueOnce(reply('{"headline": "Cut', 'max_tokens'));
    expect((await coachReport(report, { apiKey: 'k' })).source).toBe('rules');
  });

  it('timeout falls back to rules and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    sdk.create.mockImplementation((_params, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {}); // never answers
    });
    const started = Date.now();
    const res = await coachReport(report, { apiKey: 'k', timeoutMs: 50 });
    expect(res).toEqual({ source: 'rules', coaching: rules, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(signal?.aborted).toBe(true);
  });

  it('no key falls back to rules without calling the API', async () => {
    for (const apiKey of [undefined, '', '   ']) {
      expect(await coachReport(report, { apiKey })).toEqual({ source: 'rules', coaching: rules, reason: 'no-key' });
    }
    expect(sdk.create).not.toHaveBeenCalled();
    expect(sdk.constructed).toEqual([]);
  });

  it('an API error falls back to rules', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdk.create.mockRejectedValue(new Error('401 invalid x-api-key'));
    expect(await coachReport(report, { apiKey: 'k' })).toMatchObject({ source: 'rules', reason: 'api-error' });
    warn.mockRestore();
  });
});

describe('POST /api/coach', () => {
  function call(method: string, body: string) {
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
    return handleCoach(req, res as unknown as ServerResponse, {}).then(() => ({ status: out.status, json: JSON.parse(out.body) }));
  }

  it('the route matches the endpoint the browser calls', () => {
    expect(COACH_ROUTE).toBe(COACH_ENDPOINT);
  });

  it('answers with rule-based coaching when there is no key', async () => {
    const { status, json } = await call('POST', JSON.stringify({ report }));
    expect(status).toBe(200);
    expect(json).toEqual({ source: 'rules', coaching: rules, reason: 'no-key' });
  });

  it('rejects other methods and malformed bodies', async () => {
    expect((await call('GET', '')).status).toBe(405);
    expect((await call('POST', 'not json')).status).toBe(400);
    expect((await call('POST', JSON.stringify({ report: { lesson: 'x' } }))).status).toBe(400);
    expect(sdk.create).not.toHaveBeenCalled();
  });
});
