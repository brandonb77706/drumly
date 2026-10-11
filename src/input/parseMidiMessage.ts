import { MIDI_NOTE_TO_PAD } from './padMaps';
import type { Hit } from './types';

const STATUS_TYPE_MASK = 0xf0;
const NOTE_ON = 0x90;

/**
 * Pure MIDI byte parser. Returns a Hit for a mapped note-on, otherwise null.
 *
 * - Note-on on any channel counts (kits are not always on channel 10).
 * - Note-on with velocity 0 is a note-off by MIDI convention and is ignored.
 * - Note-off, control change (e.g. hi-hat pedal position CC4), aftertouch
 *   (cymbal choke), and everything else are ignored.
 * - Messages shorter than 3 bytes and unmapped notes are ignored.
 *
 * @param data raw message bytes (MIDIMessageEvent.data)
 * @param time the event's own timestamp (MIDIMessageEvent.timeStamp), ms on the performance.now() clock
 */
export function parseMidiMessage(data: ArrayLike<number> | null | undefined, time: number): Hit | null {
  if (!data || data.length < 3) return null;

  const status = data[0]!;
  if ((status & STATUS_TYPE_MASK) !== NOTE_ON) return null;

  const note = data[1]! & 0x7f;
  const velocity = data[2]! & 0x7f;
  if (velocity === 0) return null;

  const pad = MIDI_NOTE_TO_PAD.get(note);
  if (pad === undefined) return null;

  return { pad, velocity, time, source: 'midi' };
}
