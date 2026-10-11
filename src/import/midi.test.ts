import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { parseLessonText } from '../lessons';
import { draftToLesson } from './draft';
import { DRUM_CHANNEL, midiInfo, midiToDraft, readMidiFile } from './midi';

const PPQ = 480;
const S = PPQ / 4; // a 16th in ticks
const BAR = PPQ * 4;

/** Build a MIDI file in memory and read it back from bytes, like an uploaded file. */
function file(build: (midi: Midi) => void, options: { bpm?: number; timeSignature?: [number, number] } = {}): Midi {
  const midi = new Midi();
  midi.header.setTempo(options.bpm ?? 100);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: options.timeSignature ?? [4, 4] });
  midi.header.update();
  build(midi);
  return readMidiFile(midi.toArray());
}

function drums(midi: Midi, notes: [number, number, number?][], channel = DRUM_CHANNEL, name = 'Drums'): void {
  const track = midi.addTrack();
  track.channel = channel;
  track.name = name;
  for (const [note, ticks, velocity = 0.7] of notes) track.addNote({ midi: note, ticks, durationTicks: S / 2, velocity });
}

describe('MIDI import', () => {
  it('a 1-bar fill on channel 10, with slightly loose timing, lands on the grid with its landing', () => {
    const midi = file((m) =>
      drums(m, [
        [38, 8 * S + 7], [38, 9 * S - 5], [48, 10 * S], [48, 11 * S + 3], [45, 12 * S], [45, 13 * S], [43, 14 * S - 9], [43, 15 * S],
        [49, BAR, 1], [36, BAR + 4],
      ]),
    );
    const info = midiInfo(midi, 'fill.mid');
    expect(info).toMatchObject({ bpm: 100, beatsPerBar: 4, bars: 2, drumTracks: [0], warnings: [] });
    const { draft, unmapped } = midiToDraft(midi, { toBar: 1, fileName: 'fill.mid' });
    expect(unmapped).toEqual([]);
    expect(draft).toMatchObject({ origin: 'midi', bpm: 100, beatsPerBar: 4, subdivision: 'sixteenth', landing: true, warnings: [] });
    expect(draft.text).toBe(
      ['CR: ---------------- | X---------------', 'T1: ----------xx---- | ----------------', 'T2: ------------xx-- | ----------------', 'SN: --------xx------ | ----------------', 'T3: --------------xx | ----------------', 'KK: ---------------- | x---------------'].join('\n'),
    );
    const { lesson, data } = draftToLesson(draft, 'my-1');
    expect(data.kind).toBe('fill');
    expect(lesson.bars).toBe(2);
    expect(lesson.focus?.end).toEqual({ bar: 1, beat: 0, subdivision: 0 });
  });

  it('a tempo change: uses the first tempo, warns, and notes keep their place in the bar', () => {
    const midi = new Midi();
    midi.header.tempos.push({ ticks: 0, bpm: 90 }, { ticks: BAR, bpm: 140 });
    midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
    midi.header.update();
    drums(midi, [[36, 0], [38, 4 * S], [36, BAR], [38, BAR + 4 * S]]);
    const read = readMidiFile(midi.toArray());
    const { draft } = midiToDraft(read);
    expect(draft.bpm).toBe(90);
    expect(draft.warnings.join(' ')).toMatch(/changes tempo \(90, 140 BPM\); using the first tempo, 90 BPM/);
    const { notes } = parseLessonText(draft.text, { beatsPerBar: 4, subdivision: 'sixteenth' });
    expect(notes.map((n) => [n.pad, n.bar, n.beat, n.subdivision])).toEqual([
      ['kick', 0, 0, 0], ['snare', 0, 1, 0], ['kick', 1, 0, 0], ['snare', 1, 1, 0],
    ]);
  });

  it('lists unmapped note numbers instead of dropping them silently', () => {
    const midi = file((m) => drums(m, [[36, 0], [39, 4 * S], [39, 12 * S], [54, 8 * S], [38, 4 * S]]));
    const { draft, unmapped } = midiToDraft(midi);
    expect(unmapped).toEqual([{ note: 39, count: 2 }, { note: 54, count: 1 }]);
    expect(draft.warnings.join(' ')).toContain('Left out 3 notes with no pad: note 39 (Hand Clap) 2×, note 54 (Tambourine) 1×');
    expect(draft.text).toContain('KK: x---');
  });

  it('a per-import note map puts a note with no pad on a chosen pad, or ignores it', () => {
    const midi = file((m) => drums(m, [[36, 0], [56, 2 * S], [56, 6 * S], [54, 8 * S], [12, 10 * S]]));
    const noteMap = new Map([[56, 'ride'], [54, 'ignore']] as const);
    const { draft, unmapped, noPad } = midiToDraft(midi, { noteMap });
    expect(noPad).toEqual([
      { note: 12, count: 1, mappedTo: null },
      { note: 54, count: 1, mappedTo: 'ignore' },
      { note: 56, count: 2, mappedTo: 'ride' },
    ]);
    // Only note 12 is still left out (and General MIDI has no name for it).
    expect(unmapped).toEqual([{ note: 12, count: 1 }]);
    expect(draft.warnings.join(' ')).toContain('Left out 1 note with no pad: note 12 1×.');
    const { notes } = parseLessonText(draft.text, { beatsPerBar: 4, subdivision: 'sixteenth' });
    expect(notes.filter((n) => n.pad === 'ride').map((n) => [n.beat, n.subdivision])).toEqual([[0, 2], [1, 2]]);
    // The map never changes the built-in notes, and an empty map is the default import.
    expect(midiToDraft(midi, { noteMap: new Map([[36, 'snare']]) }).draft.text).toContain('KK: x---');
    expect(midiToDraft(midi).unmapped.map((u) => u.note)).toEqual([12, 54, 56]);
  });

  it('a bar range pulls a fill out of a longer song, landing included', () => {
    // 12 bars of groove; bars 9-10 hold a tom fill, bar 11 starts with a crash.
    const notes: [number, number][] = [];
    for (let bar = 0; bar < 12; bar++) {
      notes.push([36, bar * BAR], [38, bar * BAR + 4 * S], [42, bar * BAR]);
      if (bar === 9) for (let s = 8; s < 16; s++) notes.push([s < 12 ? 48 : 43, bar * BAR + s * S]);
      if (bar === 10) notes.push([49, bar * BAR]);
    }
    const midi = file((m) => drums(m, notes), { bpm: 128 });
    expect(midiInfo(midi).bars).toBe(12);
    const { draft } = midiToDraft(midi, { fromBar: 9, toBar: 10, fileName: 'song.mid' });
    expect(draft.title).toBe('song (bars 9–10)');
    const { notes: parsed, bars } = parseLessonText(draft.text, { beatsPerBar: 4, subdivision: 'sixteenth' });
    expect(bars).toBe(3); // bars 9-10 plus the landing bar
    expect(parsed.filter((n) => n.pad === 'tom1').map((n) => n.bar)).toEqual([1, 1, 1, 1]);
    // The landing bar holds only beat 1: crash, kick, hi-hat. Bar 11's snare on beat 2 is left out.
    expect(parsed.filter((n) => n.bar === 2).map((n) => [n.pad, n.beat])).toEqual([['crash', 0], ['hihatClosed', 0], ['kick', 0]]);
  });

  it('a long range is a song: no landing bar, saved under songs', () => {
    const notes: [number, number][] = [];
    for (let bar = 0; bar < 8; bar++) notes.push([36, bar * BAR], [38, bar * BAR + 4 * S]);
    const { draft } = midiToDraft(file((m) => drums(m, notes)));
    expect(draft.landing).toBe(false);
    const { data, lesson } = draftToLesson(draft, 'my-s');
    expect(data.kind).toBe('song');
    expect(lesson).toMatchObject({ category: 'song', bars: 8 });
  });

  it('triplets can be chosen, and 3/4 sets 3 beats per bar', () => {
    const T = PPQ / 3;
    const midi = file((m) => drums(m, [[38, 0], [38, T], [38, 2 * T + 6], [36, 3 * PPQ]]), { timeSignature: [3, 4] });
    const { draft } = midiToDraft(midi, { subdivision: 'triplet', toBar: 1 });
    expect(draft.beatsPerBar).toBe(3);
    expect(draft.text.split('\n')).toEqual(['SN: xxx------ | ---------', 'KK: --------- | x--------']);
  });

  it('no channel-10 notes: uses the busiest track and says so; a chosen track wins', () => {
    const midi = file((m) => {
      drums(m, [[60, 0]], 0, 'Piano');
      drums(m, [[36, 0], [38, 4 * S], [36, 8 * S]], 1, 'Beat');
    });
    expect(midiInfo(midi).drumTracks).toEqual([]);
    const auto = midiToDraft(midi);
    expect(auto.draft.warnings.join(' ')).toContain('No notes on channel 10 (drums); using "Beat"');
    expect(auto.noteCount).toBe(3);
    expect(midiToDraft(midi, { tracks: [0] }).unmapped).toEqual([{ note: 60, count: 1 }]);
  });

  it('rejects bytes that are not MIDI', () => {
    expect(() => readMidiFile(new TextEncoder().encode('hello'))).toThrow(/Not a readable MIDI file/);
  });
});
