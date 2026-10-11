import type { Pad } from './types';

/**
 * MIDI note number -> pad.
 *
 * Base: General MIDI percussion map (channel 10 convention, but we accept any channel).
 * Extras: Roland V-Drums default zone notes (TD-series modules). Roland lets you
 * reassign notes per kit, so if a pad does nothing on your kit, check the module's
 * MIDI note assignment and edit this table.
 */
export const MIDI_NOTE_TO_PAD: ReadonlyMap<number, Pad> = new Map<number, Pad>([
  // Kick
  [35, 'kick'], // GM Acoustic Bass Drum
  [36, 'kick'], // GM Bass Drum 1 / Roland kick

  // Snare
  [37, 'crossStick'], // GM Side Stick / Roland snare cross-stick
  [38, 'snare'], // GM Acoustic Snare / Roland snare head
  [40, 'snareRim'], // Roland snare rim (GM Electric Snare)

  // Hi-hat
  [42, 'hihatClosed'], // GM Closed Hi-Hat / Roland closed bow
  [22, 'hihatClosed'], // Roland closed edge
  [46, 'hihatOpen'], // GM Open Hi-Hat / Roland open bow
  [26, 'hihatOpen'], // Roland open edge
  [44, 'hihatPedal'], // GM Pedal Hi-Hat / Roland pedal chick

  // Toms (head + Roland rim)
  [48, 'tom1'], // GM Hi-Mid Tom / Roland tom 1 head
  [50, 'tom1'], // Roland tom 1 rim (GM High Tom)
  [45, 'tom2'], // GM Low Tom / Roland tom 2 head
  [47, 'tom2'], // Roland tom 2 rim (GM Low-Mid Tom)
  [43, 'tom3'], // GM High Floor Tom / Roland tom 3 head
  [58, 'tom3'], // Roland tom 3 rim
  [41, 'tom3'], // GM Low Floor Tom / Roland tom 4 head (folded into tom3)

  // Cymbals
  [49, 'crash'], // GM Crash 1 / Roland crash 1 bow
  [55, 'crash'], // Roland crash 1 edge
  [57, 'crash2'], // GM Crash 2 / Roland crash 2 bow
  [52, 'crash2'], // Roland crash 2 edge
  [51, 'ride'], // GM Ride 1 / Roland ride bow
  [59, 'ride'], // Roland ride edge
  [53, 'rideBell'], // GM Ride Bell / Roland ride bell
]);

/** KeyboardEvent.code -> pad. Uses physical key positions, so it works on any layout. */
export const KEYBOARD_CODE_TO_PAD: ReadonlyMap<string, Pad> = new Map<string, Pad>([
  ['Space', 'kick'],
  ['KeyF', 'kick'],
  ['KeyJ', 'snare'],
  ['KeyK', 'hihatClosed'],
  ['KeyI', 'hihatOpen'],
  ['KeyD', 'hihatPedal'],
  ['KeyU', 'tom1'],
  ['KeyO', 'tom2'],
  ['KeyL', 'tom3'],
  ['KeyY', 'crash'],
  ['Semicolon', 'ride'],
]);

/** Short on-screen label for a KeyboardEvent.code. */
export function keyCodeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code === 'Semicolon') return ';';
  return code;
}
