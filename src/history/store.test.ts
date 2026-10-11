import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomLessonStore, type CustomLessonData, type StorageLike } from '../record/customLessons';
import { HistoryStore, migrateLegacyLessons, openDrumlyDb, type DrumlyDatabase } from './store';
import { session } from './testData';

beforeEach(() => {
  // A fresh, empty IndexedDB for every test.
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const lesson = (id: string, title = 'My fill'): CustomLessonData => ({ id, title, bpm: 70, bars: 1, beatsPerBar: 4, subdivision: 'sixteenth', text: 'SN: x-x-x-x-xxxxxxxx' });

function legacyStorage(items: unknown): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>([['drumly.customLessons', JSON.stringify(items)]]);
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

/** A database where writing a custom lesson fails, like a full disk (wrapped from outside, so idb itself is untouched). */
function fullDisk(db: DrumlyDatabase): DrumlyDatabase {
  const bound = (target: object, key: PropertyKey) => {
    const v = Reflect.get(target, key);
    return typeof v === 'function' ? v.bind(target) : v;
  };
  return new Proxy(db, {
    get(target, key) {
      if (key !== 'transaction') return bound(target, key);
      return (stores: never, mode: never) => {
        const tx = target.transaction(stores, mode);
        if (mode !== 'readwrite' || String(stores) !== 'lessons') return tx;
        const store = new Proxy(tx.store, {
          get: (s, k) => (k === 'put' ? () => Promise.reject(new DOMException('full', 'QuotaExceededError')) : bound(s, k)),
        });
        return new Proxy(tx, { get: (t, k) => (k === 'store' ? store : bound(t, k)) });
      };
    },
  });
}

describe('HistoryStore sessions', () => {
  it('saves and loads a session, also after reopening the database (a reload)', async () => {
    const store = await HistoryStore.open();
    expect(store.available).toBe(true);
    expect(await store.saveSession(session())).toBe(true);
    const reopened = await HistoryStore.open();
    expect(await reopened.getSession('s1')).toEqual(session());
  });

  it('lists sessions newest first, and per lesson', async () => {
    const store = await HistoryStore.open();
    const day = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
    await store.saveSession(session({ id: 'b', startedAt: day(9) }));
    await store.saveSession(session({ id: 'c', startedAt: day(11), lessonId: 'fill-1' }));
    await store.saveSession(session({ id: 'a', startedAt: day(3) }));
    await store.saveSession(session({ id: 'd', startedAt: day(11, 20) }));
    expect((await store.listSessions()).map((s) => s.id)).toEqual(['d', 'c', 'b', 'a']);
    expect((await store.sessionsForLesson('rock-1')).map((s) => s.id)).toEqual(['d', 'b', 'a']);
    expect((await store.sessionsForLesson('nope')).length).toBe(0);
  });

  it('attaches coaching that arrives after the session was saved', async () => {
    const store = await HistoryStore.open();
    await store.saveSession(session());
    const coaching = { source: 'claude' as const, coaching: { headline: 'Nice', wentWell: [], fixThis: [], nextExercise: 'More' } };
    expect(await store.updateCoaching('s1', coaching)).toBe(true);
    expect((await store.getSession('s1'))!.coaching).toEqual(coaching);
    expect(await store.updateCoaching('missing', coaching)).toBe(false);
  });

  it('skips stored records it cannot read instead of failing', async () => {
    const store = await HistoryStore.open();
    await store.saveSession(session({ id: 'good' }));
    const db = await openDrumlyDb();
    await db.put('sessions', { id: 'junk', startedAt: 5 } as never);
    db.close();
    expect((await store.listSessions()).map((s) => s.id)).toEqual(['good']);
  });
});

describe('moving custom lessons from localStorage', () => {
  it('moves them into IndexedDB once and removes the old key', async () => {
    const storage = legacyStorage([lesson('my-a', 'A'), lesson('my-b', 'B')]);
    const store = await HistoryStore.open({ legacyStorage: () => storage });
    expect(store.migration).toBe('migrated');
    expect(store.initialLessons.map((l) => l.id).sort()).toEqual(['my-a', 'my-b']);
    expect(storage.data.has('drumly.customLessons')).toBe(false);
    // The next start finds nothing left to move, and the lessons are still there.
    const again = await HistoryStore.open({ legacyStorage: () => storage });
    expect(again.migration).toBe('none');
    expect((await again.listLessons()).map((l) => l.title).sort()).toEqual(['A', 'B']);
  });

  it('does not overwrite a lesson already in IndexedDB with the same id', async () => {
    const first = await HistoryStore.open();
    await first.put(lesson('my-a', 'Newer'));
    const storage = legacyStorage([lesson('my-a', 'Older'), lesson('my-b')]);
    const store = await HistoryStore.open({ legacyStorage: () => storage });
    expect((await store.listLessons()).find((l) => l.id === 'my-a')!.title).toBe('Newer');
  });

  it('loses nothing if the move fails halfway: the transaction is undone and localStorage is kept', async () => {
    // The second lesson can't be stored (a function can't be cloned), after the first was written.
    const broken = { ...lesson('my-b'), extra: () => 1 } as unknown as CustomLessonData;
    const db = await openDrumlyDb();
    expect(await migrateLegacyLessons(db, [lesson('my-a'), broken])).toBe(false);
    expect(await db.getAll('lessons')).toEqual([]);
    db.close();

    // Through the store: the old key stays, and the lessons are still shown from it.
    const storage = legacyStorage([lesson('my-a', 'A')]);
    const failingOpen = async () => fullDisk(await openDrumlyDb());
    const store = await HistoryStore.open({ open: failingOpen, legacyStorage: () => storage });
    expect(store.migration).toBe('failed');
    expect(storage.data.has('drumly.customLessons')).toBe(true);
    expect(store.initialLessons.map((l) => l.title)).toEqual(['A']);

    // Next time storage works, the move completes.
    const ok = await HistoryStore.open({ legacyStorage: () => storage });
    expect(ok.migration).toBe('migrated');
    expect((await ok.listLessons()).map((l) => l.title)).toEqual(['A']);
    expect(storage.data.has('drumly.customLessons')).toBe(false);
  });

  it('custom lessons saved through the store survive a reload', async () => {
    const history = await HistoryStore.open();
    const lessons = new CustomLessonStore(history.initialLessons, history);
    expect((await lessons.save(lesson('my-z', 'Z'))).persisted).toBe(true);
    const reloaded = await HistoryStore.open();
    expect(new CustomLessonStore(reloaded.initialLessons, reloaded).list().map((l) => l.title)).toEqual(['Z']);
  });
});

describe('when IndexedDB is unavailable', () => {
  it('opening never throws; everything works in memory for the page session and says so once', async () => {
    const onUnavailable = vi.fn();
    const storage = legacyStorage([lesson('my-a', 'A')]);
    const store = await HistoryStore.open({
      open: () => Promise.reject(new DOMException('blocked', 'InvalidStateError')),
      legacyStorage: () => storage,
      onUnavailable,
    });
    expect(store.available).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    // Old lessons are still shown, and the old key is kept for a browser where storage works.
    expect(store.initialLessons.map((l) => l.title)).toEqual(['A']);
    expect(storage.data.has('drumly.customLessons')).toBe(true);

    expect(await store.saveSession(session())).toBe(false);
    expect((await store.listSessions()).map((s) => s.id)).toEqual(['s1']);
    expect((await store.sessionsForLesson('rock-1')).length).toBe(1);
    const lessons = new CustomLessonStore(store.initialLessons, store);
    expect((await lessons.save(lesson('my-b'))).persisted).toBe(false);
    expect(lessons.list().map((l) => l.id)).toEqual(['my-a', 'my-b']);
    expect(await store.importAll([session({ id: 's2' })], [])).toBe(false);
    expect((await store.listSessions()).length).toBe(2);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('a database that throws later switches to memory without losing the call', async () => {
    const onUnavailable = vi.fn();
    const db = await openDrumlyDb();
    const store = await HistoryStore.open({ open: async () => db, onUnavailable });
    expect(store.available).toBe(true);
    db.close(); // every call on a closed database throws
    expect(await store.saveSession(session())).toBe(false);
    expect(store.available).toBe(false);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect((await store.listSessions()).map((s) => s.id)).toEqual(['s1']);
  });

  it('an open() that throws synchronously is handled too', async () => {
    const store = await HistoryStore.open({ open: () => { throw new Error('no indexedDB'); } });
    expect(store.available).toBe(false);
    expect(await store.listLessons()).toEqual([]);
  });
});
