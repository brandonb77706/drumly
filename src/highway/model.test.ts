import { describe, expect, it } from 'vitest';
import { grade, type HitVerdict } from '../grading';
import type { Hit, Pad } from '../input';
import { ClickScheduler } from '../metronome/ClickScheduler';
import { lessonFromText, lessonToExpectedNotes, type Lesson } from '../lessons';
import { HighwayModel, type HighwayClick } from './model';

const lesson: Lesson = lessonFromText({
  id: 'hw',
  title: 'hw',
  description: '',
  defaultBpm: 120,
  beatsPerBar: 4,
  subdivision: 'eighth',
  text: `
HH: xxxxxxxx
SN: --X---x-
KK: x---x---
`,
});

/** Grid source over the pure scheduler: 120 BPM 8ths, 1-bar count-in from t = 1000 ms. */
function gridSource(shiftMs = 0) {
  const s = new ClickScheduler({ bpm: 120, beatsPerBar: 4, subdivision: 'eighth', countIn: true });
  s.start(1);
  const clicks: HighwayClick[] = s.scheduleUntil(20).map((c) => ({ ...c, time: c.time * 1000 + shiftMs }));
  return (from: number, to: number) => clicks.filter((c) => c.time >= from && c.time < to);
}

const hit = (pad: Pad, time: number): Hit => ({ pad, time, velocity: 100, source: 'test' });

describe('HighwayModel', () => {
  it('reads notes and beat lines from the grid: count-in markers, bar and beat lines', () => {
    const model = new HighwayModel(lesson);
    model.refresh(1000, gridSource());
    // Count-in: 4 quarter clicks at 1000, 1500, 2000, 2500. Bar 0 starts at 3000.
    expect(model.lines.slice(0, 6).map((l) => [l.kind, l.time])).toEqual([
      ['countIn', 1000],
      ['countIn', 1500],
      ['countIn', 2000],
      ['countIn', 2500],
      ['bar', 3000],
      ['beat', 3500],
    ]);
    expect(model.lines.every((l, i) => i === 0 || l.time > model.lines[i - 1]!.time)).toBe(true);
    // 2.6 s ahead of t=1000 reaches the 8th at 3500 only.
    expect(model.notes.map((n) => [n.pad, n.time])).toEqual([
      ['hihatClosed', 3000],
      ['kick', 3000],
      ['hihatClosed', 3250],
      ['hihatClosed', 3500],
      ['snare', 3500],
    ]);
  });

  it('marks accents and puts each note in its lane', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    expect(model.lanes).toEqual(['hihatClosed', 'snare', 'kick']);
    const snare = model.notes.find((n) => n.pad === 'snare')!;
    expect(snare).toMatchObject({ lane: 1, accent: true });
    expect(model.notes.find((n) => n.pad === 'kick')).toMatchObject({ lane: 2, accent: false });
  });

  it('only re-reads the grid every refreshMs', () => {
    let reads = 0;
    const source = gridSource();
    const counting = (from: number, to: number) => {
      reads++;
      return source(from, to);
    };
    const model = new HighwayModel(lesson, { refreshMs: 200 });
    for (let t = 1000; t < 2000; t += 16) model.refresh(t, counting);
    expect(reads).toBe(5);
  });

  it('updates notes in place when the grid moves (clock reference shift), without duplicates', () => {
    const model = new HighwayModel(lesson);
    model.refresh(2000, gridSource());
    const before = model.notes.map((n) => n.id);
    const firstNote = model.notes[0]!;
    model.refresh(2000, gridSource(7), true);
    expect(model.notes.map((n) => n.id)).toEqual(before);
    expect(model.notes[0]).toBe(firstNote); // same record, moved
    expect(firstNote.time).toBe(3007);
    expect(model.lines.find((l) => l.kind === 'bar')!.time).toBe(3007);
  });

  it('drops notes, lines and ticks once they are pastMs behind', () => {
    const model = new HighwayModel(lesson, { pastMs: 500 });
    model.refresh(3000, gridSource());
    model.applyVerdict(hit('tom1', 3010), { status: 'extra', hit: hit('tom1', 3010) });
    model.refresh(4000, gridSource(), true);
    expect(model.notes[0]!.time).toBeGreaterThanOrEqual(3500);
    expect(model.lines[0]!.time).toBeGreaterThanOrEqual(3500);
    expect(model.ticks).toHaveLength(0);
  });

  it('colors notes from hit verdicts and places a tick at the real hit time', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const kickNote = model.notes.find((n) => n.pad === 'kick')!;
    const h = hit('kick', 3030);
    model.applyVerdict(h, { status: 'hit', note: { id: kickNote.id, pad: 'kick', time: 3000 }, hit: h, offsetMs: 30, timing: 'good' });
    expect(kickNote).toMatchObject({ state: 'good', hit: h });
    expect(model.ticks).toEqual([{ hit: h, lane: 2, state: 'good' }]);
  });

  it('extras get a gray tick in their own lane, or the "other" strip if the pad has no lane', () => {
    const model = new HighwayModel(lesson);
    const snareExtra = hit('snare', 3100);
    const tomExtra = hit('tom2', 3200);
    model.applyVerdict(snareExtra, { status: 'extra', hit: snareExtra });
    model.applyVerdict(tomExtra, { status: 'extra', hit: tomExtra });
    expect(model.ticks.map((t) => [t.lane, t.state])).toEqual([
      [1, 'extra'],
      [-1, 'extra'],
    ]);
  });

  it('a revised hit updates colors: the stolen note keeps the new hit, the old hit becomes extra', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const kickNote = model.notes.find((n) => n.pad === 'kick')!;
    const note = { id: kickNote.id, pad: 'kick' as const, time: 3000 };
    const first = hit('kick', 2920);
    const second = hit('kick', 3005);
    model.applyVerdict(first, { status: 'hit', note, hit: first, offsetMs: -80, timing: 'early' });
    expect(kickNote.state).toBe('early');
    // The grader reports the new hit first, then revises the old one.
    model.applyVerdict(second, { status: 'hit', note, hit: second, offsetMs: 5, timing: 'perfect' });
    model.applyVerdict(first, { status: 'extra', hit: first });
    expect(kickNote).toMatchObject({ state: 'perfect', hit: second });
    expect(model.ticks.map((t) => [t.hit.time, t.state])).toEqual([
      [2920, 'extra'],
      [3005, 'perfect'],
    ]);
  });

  it('a revision that frees a note returns it to pending (or missed if it was reported missed)', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const [a, b] = model.notes.filter((n) => n.pad === 'hihatClosed');
    const h = hit('hihatClosed', 3010);
    const toA: HitVerdict = { status: 'hit', note: { id: a!.id, pad: 'hihatClosed', time: a!.time }, hit: h, offsetMs: 10, timing: 'perfect' };
    const toB: HitVerdict = { status: 'hit', note: { id: b!.id, pad: 'hihatClosed', time: b!.time }, hit: h, offsetMs: -240, timing: 'early' };
    model.applyVerdict(h, toA);
    model.applyVerdict(h, toB);
    expect(a!.state).toBe('pending');
    expect(b!.state).toBe('early');
    model.markMissed({ id: a!.id, pad: 'hihatClosed', time: a!.time });
    model.applyVerdict(h, toA);
    expect(a!.state).toBe('perfect'); // a hit beats an earlier "missed"
    model.applyVerdict(h, toB);
    expect(a!.state).toBe('missed');
  });

  it('missed notes turn missed; a matched note is not overwritten by a stale miss', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const [n0, n1] = model.notes;
    model.markMissed({ id: n0!.id, pad: n0!.pad, time: n0!.time });
    expect(n0!.state).toBe('missed');
    const h = hit(n1!.pad, n1!.time);
    model.applyVerdict(h, { status: 'hit', note: { id: n1!.id, pad: n1!.pad, time: n1!.time }, hit: h, offsetMs: 0, timing: 'perfect' });
    model.markMissed({ id: n1!.id, pad: n1!.pad, time: n1!.time });
    expect(n1!.state).toBe('perfect');
  });

  it('wrong pad notes show wrongPad, with the tick in the note\'s lane', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const snare = model.notes.find((n) => n.pad === 'snare')!;
    const h = hit('tom1', 3502);
    model.applyVerdict(h, { status: 'wrongPad', note: { id: snare.id, pad: 'snare', time: 3500 }, hit: h, offsetMs: 2, timing: 'perfect' });
    expect(snare.state).toBe('wrongPad');
    expect(model.ticks[0]).toMatchObject({ lane: 1, state: 'wrongPad' });
  });

  it('syncResults makes the highway match a batch grade exactly', () => {
    const model = new HighwayModel(lesson);
    const source = gridSource();
    model.refresh(3000, source);
    model.refresh(4500, source, true);
    const notes = lessonToExpectedNotes(lesson, source(0, 10_000)).filter((n) => n.time <= 6000);
    // Play everything perfectly except one late kick, a missed snare, and an extra tom.
    const hits = notes
      .filter((n) => !(n.pad === 'snare' && n.time === 4500))
      .map((n) => hit(n.pad, n.pad === 'kick' && n.time === 4000 ? 4060 : n.time));
    hits.push(hit('tom1', 4125));
    const results = grade(notes, hits);
    // Some stale live state that the final grade must override.
    model.markMissed(notes[0]!);
    model.syncResults(results);
    const shown = new Map(model.notes.map((n) => [n.id, n.state]));
    for (const r of results.notes) {
      if (!shown.has(r.note.id)) continue;
      expect(shown.get(r.note.id)).toBe(r.status === 'hit' ? r.timing : r.status);
    }
    expect(shown.get(notes.find((n) => n.pad === 'snare' && n.time === 4500)!.id)).toBe('missed');
    expect(shown.get(notes.find((n) => n.pad === 'kick' && n.time === 4000)!.id)).toBe('late');
    expect(model.ticks.filter((t) => t.state === 'extra').map((t) => t.hit.pad)).toEqual(['tom1']);
  });

  it('takePassed reports each note once, as it reaches the now line', () => {
    const model = new HighwayModel(lesson);
    model.refresh(3000, gridSource());
    const seen: string[] = [];
    model.takePassed(2999, (n) => seen.push(n.pad));
    expect(seen).toEqual([]);
    model.takePassed(3000, (n) => seen.push(n.pad));
    expect(seen).toEqual(['hihatClosed', 'kick']);
    model.takePassed(3260, (n) => seen.push(n.pad));
    model.takePassed(3270, (n) => seen.push(n.pad));
    expect(seen).toEqual(['hihatClosed', 'kick', 'hihatClosed']);
  });

  it('loop mode keeps producing notes for later passes', () => {
    const model = new HighwayModel(lesson, { passes: Infinity });
    model.refresh(8000, gridSource());
    // One-bar lesson at 120 BPM: pass 1 starts at 5000, pass 2 at 7000.
    expect(model.notes.some((n) => n.id.startsWith('hw#2.'))).toBe(true);
    const single = new HighwayModel(lesson);
    single.refresh(8000, gridSource());
    expect(single.notes).toHaveLength(0); // the single pass is behind pastMs
  });
});
