import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomLessonData } from '../record/customLessons';
import { buildHistoryFile, historyFileName, importCounts, parseHistoryFile, readSettings } from './backup';
import { HistoryStore } from './store';
import { pass, session } from './testData';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const lesson = (id: string): CustomLessonData => ({ id, title: `Fill ${id}`, bpm: 70, bars: 1, beatsPerBar: 4, subdivision: 'sixteenth', text: 'SN: x-x-x-x-xxxxxxxx', kind: 'fill', origin: 'recorded' });
const settings = { clickMode: 'countInOnly', hitSounds: 'all', drumsVolume: 60, clickVolume: 40, guideDrums: true, coachSpeak: false };
const now = new Date(2026, 9, 11, 9, 30);

async function exportFrom(store: HistoryStore) {
  return JSON.stringify(buildHistoryFile(await store.listSessions(), await store.listLessons(), settings, now));
}

describe('export and import', () => {
  it('an export imported into an empty history gives identical data', async () => {
    const a = await HistoryStore.open();
    await a.saveSession(session({ id: 's1', passes: [pass({ meanMs: 0 }), pass({ bpm: 92.5, clean: false, focusAccuracy: null })] }));
    await a.saveSession(session({ id: 's2', startedAt: 5, mode: 'record', passes: [], lessonId: 'recording' }));
    await a.put(lesson('my-a'));
    const text = await exportFrom(a);

    globalThis.indexedDB = new IDBFactory(); // another browser
    const b = await HistoryStore.open();
    const parsed = parseHistoryFile(text);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.file.settings).toEqual(settings);
    expect(await b.importAll(parsed.file.sessions, parsed.file.lessons)).toBe(true);
    expect(await exportFrom(b)).toBe(text);
  });

  it('importing twice does not duplicate anything', async () => {
    const a = await HistoryStore.open();
    await a.saveSession(session({ id: 's1' }));
    await a.put(lesson('my-a'));
    const parsed = parseHistoryFile(await exportFrom(a));
    if (!parsed.ok) throw new Error(parsed.message);
    await a.importAll(parsed.file.sessions, parsed.file.lessons);
    await a.importAll(parsed.file.sessions, parsed.file.lessons);
    expect((await a.listSessions()).map((s) => s.id)).toEqual(['s1']);
    expect((await a.listLessons()).map((l) => l.id)).toEqual(['my-a']);
  });

  it('the confirmation counts what is in the file and what is new', async () => {
    const file = buildHistoryFile([session({ id: 's1' }), session({ id: 's2' })], [lesson('my-a')], {}, now);
    expect(importCounts(file, new Set(['s1']), new Set())).toEqual({ sessions: 2, lessons: 1, newSessions: 1, newLessons: 1 });
  });

  it('the file name has the local date', () => {
    expect(historyFileName(now)).toBe('drumly-history-2026-10-11.json');
  });
});

describe('rejecting bad files', () => {
  const good = () => JSON.parse(JSON.stringify(buildHistoryFile([session()], [lesson('my-a')], settings, now)));
  const reject = (value: unknown) => {
    const r = parseHistoryFile(typeof value === 'string' ? value : JSON.stringify(value));
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.message;
  };

  it('accepts a good file', () => {
    expect(parseHistoryFile(JSON.stringify(good())).ok).toBe(true);
  });

  it('not JSON, or not a history file', () => {
    expect(reject('{oops')).toMatch(/isn't valid JSON/);
    expect(reject([1, 2])).toMatch(/isn't a Drumly history file/);
    expect(reject({ ...good(), format: 'something-else' })).toMatch(/isn't a Drumly history file/);
  });

  it('a missing or newer schema version', () => {
    expect(reject({ ...good(), schemaVersion: undefined })).toMatch(/no valid schema version/);
    expect(reject({ ...good(), schemaVersion: 99 })).toMatch(/newer version of Drumly/);
  });

  it('a damaged session or lesson rejects the whole file, naming which one', () => {
    const f = good();
    f.sessions.push({ ...f.sessions[0], id: 's9', passes: [{ bpm: 'fast' }] });
    expect(reject(f)).toBe("This history file is damaged: session 2 of 2 can't be read. Nothing was imported.");
    const g = good();
    g.lessons[0].text = 'SN: x-x';
    expect(reject(g)).toMatch(/lesson 1 of 1 can't be read/);
    expect(reject({ ...good(), sessions: 'nope' })).toMatch(/no session or lesson list/);
  });

  it('unknown or mistyped settings are dropped', () => {
    expect(readSettings({ clickMode: 'on', drumsVolume: 'loud', hack: 1 })).toEqual({ clickMode: 'on' });
    expect(readSettings(null)).toEqual({});
  });
});
