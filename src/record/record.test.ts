import { describe, expect, it } from 'vitest';
import type { Hit } from '../input';
import { parseLessonText, type LessonNote } from '../lessons';
import { CustomLessonStore, customLesson, isCustomLesson, type CustomLessonData, type StorageLike } from './customLessons';
import { gridStepMs, notesToText, quantizeHits, type RecordGrid } from './quantize';

const hit = (pad: Hit['pad'], time: number, velocity = 90) => ({ pad, time, velocity });
const sixteenths: RecordGrid = { startTime: 1000, bpm: 60, bars: 1, beatsPerBar: 4, subdivision: 'sixteenth' }; // a step is 250 ms

describe('quantizeHits', () => {
  it('snaps each hit to the nearest grid step', () => {
    const notes = quantizeHits([hit('snare', 1000 + 230), hit('kick', 1000 - 40), hit('tom1', 1000 + 4 * 250 + 110)], sixteenths);
    expect(notes).toEqual([
      { pad: 'kick', bar: 0, beat: 0, subdivision: 0 },
      { pad: 'snare', bar: 0, beat: 0, subdivision: 1 },
      { pad: 'tom1', bar: 0, beat: 1, subdivision: 0 },
    ]);
  });

  it('a hit exactly between two steps goes to the later one, whatever the order', () => {
    expect(quantizeHits([hit('snare', 1000 + 125)], sixteenths)).toEqual([{ pad: 'snare', bar: 0, beat: 0, subdivision: 1 }]);
    // Triplet steps at 120 BPM are 166.67 ms: the halfway point in float still goes up.
    const triplets: RecordGrid = { startTime: 0, bpm: 120, bars: 1, beatsPerBar: 4, subdivision: 'triplet' };
    const half = gridStepMs(triplets) * 4.5;
    expect(quantizeHits([hit('tom2', half)], triplets)).toEqual([{ pad: 'tom2', bar: 0, beat: 1, subdivision: 2 }]);
  });

  it('merges duplicate hits on the same pad and step (a flam, a double tap), keeping the accent', () => {
    const notes = quantizeHits([hit('snare', 1490), hit('snare', 1510, 127), hit('snare', 1530), hit('kick', 1500)], sixteenths);
    expect(notes).toEqual([
      { pad: 'snare', bar: 0, beat: 0, subdivision: 2, accent: true },
      { pad: 'kick', bar: 0, beat: 0, subdivision: 2 },
    ]);
  });

  it('works on a triplet grid', () => {
    const grid: RecordGrid = { startTime: 0, bpm: 90, bars: 1, beatsPerBar: 4, subdivision: 'triplet' };
    const step = gridStepMs(grid); // 222.2 ms
    const notes = quantizeHits([hit('snare', 9 * step + 12), hit('tom1', 10 * step - 30), hit('tom2', 11 * step + 50)], grid);
    expect(notes).toEqual([
      { pad: 'snare', bar: 0, beat: 3, subdivision: 0 },
      { pad: 'tom1', bar: 0, beat: 3, subdivision: 1 },
      { pad: 'tom2', bar: 0, beat: 3, subdivision: 2 },
    ]);
  });

  it('drops hits nearer a step outside the recorded bars', () => {
    const late = 1000 + 16 * 250 - 100; // nearer the next bar's downbeat
    expect(quantizeHits([hit('crash', late), hit('kick', 1000 - 130)], sixteenths)).toEqual([]);
  });
});

describe('record round trip', () => {
  it('a scripted recorded fill -> quantize -> text -> parse gives back the same notes', () => {
    const grid: RecordGrid = { startTime: 5000, bpm: 80, bars: 2, beatsPerBar: 4, subdivision: 'sixteenth' };
    const step = gridStepMs(grid);
    // Bar 1: groove; bar 2: snare-tom fill with a crash on a downbeat, played with keyboard-ish jitter.
    const script: [Hit['pad'], number, number][] = [
      ['kick', 0, -12], ['hihatClosed', 0, 8], ['hihatClosed', 2, -20], ['snare', 4, 15], ['hihatClosed', 4, 0],
      ['kick', 8, 25], ['hihatClosed', 8, -5], ['snare', 12, -30], ['crash', 16, 3], ['kick', 16, -3],
      ['snare', 24, 10], ['snare', 25, -10], ['tom1', 26, 20], ['tom1', 27, -25], ['tom2', 28, 5], ['tom3', 30, 0], ['tom3', 31, 30],
    ];
    const hits = script.map(([pad, s, jitter]) => hit(pad, grid.startTime + s * step + jitter, pad === 'crash' ? 127 : 90));
    const notes = quantizeHits(hits, grid);
    expect(notes).toHaveLength(script.length);
    const text = notesToText(notes, grid);
    expect(text.split('\n')[0]).toBe('CR: ---------------- | X---------------');
    const parsed = parseLessonText(text, { beatsPerBar: 4, subdivision: 'sixteenth', bars: 2 });
    expect(parsed.notes).toEqual(notes);
    // And as a saved custom lesson.
    const lesson = customLesson({ id: 'my-1', title: 'Roundtrip', bpm: 80, bars: 2, beatsPerBar: 4, subdivision: 'sixteenth', text });
    expect(lesson.notes).toEqual(notes);
  });

  it('triplets round trip too', () => {
    const grid: RecordGrid = { startTime: 0, bpm: 70, bars: 1, beatsPerBar: 4, subdivision: 'triplet' };
    const step = gridStepMs(grid);
    const notes: LessonNote[] = quantizeHits([0, 3, 6, 9, 10, 11].map((s, i) => hit(i < 3 ? 'kick' : 'snare', s * step + 7)), grid);
    expect(parseLessonText(notesToText(notes, grid), { beatsPerBar: 4, subdivision: 'triplet', bars: 1 }).notes).toEqual(notes);
  });
});

/** In-memory storage, optionally throwing like a blocked localStorage. */
function memoryStorage(throws = false): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => {
      if (throws) throw new DOMException('blocked', 'SecurityError');
      return data.get(k) ?? null;
    },
    setItem: (k, v) => {
      if (throws) throw new DOMException('blocked', 'SecurityError');
      data.set(k, v);
    },
  };
}

const sample = (id: string, title = 'My fill'): CustomLessonData => ({ id, title, bpm: 70, bars: 1, beatsPerBar: 4, subdivision: 'sixteenth', text: 'SN: x-x-x-x-xxxxxxxx\nKK: x-------x-------' });

describe('CustomLessonStore', () => {
  it('saves, loads (in a new store, like after a reload) and deletes', () => {
    const storage = memoryStorage();
    const store = new CustomLessonStore(() => storage);
    const { lesson, persisted } = store.save(sample('my-a', 'Fill A'));
    expect(persisted).toBe(true);
    expect(lesson).toMatchObject({ id: 'my-a', title: 'Fill A', category: 'fill', bars: 1, defaultBpm: 70 });
    expect(lesson.focus).toEqual({ start: { bar: 0, beat: 0, subdivision: 0 }, end: { bar: 0, beat: 3, subdivision: 3 } });
    expect(isCustomLesson(lesson)).toBe(true);
    store.save(sample('my-b', 'Fill B'));

    const reloaded = new CustomLessonStore(() => storage);
    expect(reloaded.list().map((l) => l.title)).toEqual(['Fill A', 'Fill B']);
    expect(reloaded.remove('my-a')).toEqual({ removed: true, persisted: true });
    expect(reloaded.remove('my-a').removed).toBe(false);
    expect(new CustomLessonStore(() => storage).list().map((l) => l.id)).toEqual(['my-b']);
  });

  it('a bad text is rejected before anything is stored', () => {
    const storage = memoryStorage();
    const store = new CustomLessonStore(() => storage);
    expect(() => store.save({ ...sample('my-x'), text: 'SN: x-x' })).toThrow(/steps/);
    expect(store.list()).toEqual([]);
    expect(storage.data.size).toBe(0);
  });

  it('keeps working when localStorage throws or is missing: lessons last for the page session', () => {
    for (const getter of [() => memoryStorage(true), () => null, () => { throw new DOMException('blocked', 'SecurityError'); }]) {
      const store = new CustomLessonStore(getter as () => StorageLike | null);
      expect(store.list()).toEqual([]);
      const saved = store.save(sample('my-a'));
      expect(saved.persisted).toBe(false);
      expect(store.list().map((l) => l.id)).toEqual(['my-a']);
      expect(store.remove('my-a')).toEqual({ removed: true, persisted: false });
      expect(store.list()).toEqual([]);
    }
  });

  it('skips damaged entries and junk', () => {
    const storage = memoryStorage();
    storage.data.set('drumly.customLessons', JSON.stringify([sample('my-ok'), { id: 'my-bad' }, { ...sample('my-text'), text: 'nonsense' }, 'x']));
    expect(new CustomLessonStore(() => storage).list().map((l) => l.id)).toEqual(['my-ok']);
    storage.data.set('drumly.customLessons', '{not json');
    expect(new CustomLessonStore(() => storage).list()).toEqual([]);
  });

  it('new ids never collide', () => {
    const storage = memoryStorage();
    const store = new CustomLessonStore(() => storage);
    const id = store.newId(1000);
    store.save(sample(id));
    expect(store.newId(1000)).not.toBe(id);
  });
});
