import { describe, expect, it } from 'vitest';
import { FILL_LESSONS } from '../lessons';
import { fallbackNote, requestCoaching } from './client';
import { buildSessionReport } from './report';
import { ruleBasedCoaching } from './rules';
import { scriptedPass } from './testSessions';

const toms = FILL_LESSONS.find((l) => l.id === 'fill-around-toms')!;
const report = buildSessionReport({ lesson: toms, passes: [scriptedPass(toms, 0, 60)] });
const rules = ruleBasedCoaching(report);
const coaching = { headline: 'Nice.', wentWell: ['Clean.'], fixThis: [], nextExercise: 'Again at 65 BPM.' };

const fakeFetch = (respond: () => Promise<Response>) => (() => respond()) as unknown as typeof fetch;
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('requestCoaching', () => {
  it('passes through Claude coaching', async () => {
    expect(await requestCoaching(report, fakeFetch(() => json({ source: 'claude', coaching })))).toEqual({ source: 'claude', coaching });
  });

  it('passes through the server fallback and its reason', async () => {
    expect(await requestCoaching(report, fakeFetch(() => json({ source: 'rules', coaching: rules, reason: 'no-key' })))).toEqual({ source: 'rules', coaching: rules, reason: 'no-key' });
  });

  it('falls back to local rules when the server is missing, errors, or answers nonsense', async () => {
    expect(await requestCoaching(report, fakeFetch(() => Promise.reject(new TypeError('Failed to fetch'))))).toEqual({ source: 'rules', coaching: rules, reason: 'unreachable' });
    expect(await requestCoaching(report, fakeFetch(() => json({ error: 'x' }, 404)))).toMatchObject({ source: 'rules', reason: 'unreachable' });
    expect(await requestCoaching(report, fakeFetch(() => json({ source: 'claude', coaching: { headline: 'x' } })))).toMatchObject({ source: 'rules', reason: 'invalid-response' });
  });

  it('times out', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    expect(await requestCoaching(report, hang, 30)).toMatchObject({ source: 'rules', reason: 'timeout' });
  });

  it('explains each fallback in plain words', () => {
    expect(fallbackNote('no-key')).toContain('ANTHROPIC_API_KEY');
    expect(fallbackNote(undefined)).toBe('');
  });
});
