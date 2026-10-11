import type { Coaching } from './types';

/**
 * Something that can read coaching out loud. The browser's speechSynthesis is one; a Jarvis
 * voice (ElevenLabs) can implement the same interface later.
 */
export interface Speaker {
  speak(text: string): void;
  stop(): void;
}

/** The default: says nothing. */
export const silentSpeaker: Speaker = {
  speak() {},
  stop() {},
};

/** The minimal part of the Web Speech API we use, so it can be faked in tests. */
export interface SpeechSynthesisLike {
  speak(utterance: SpeechSynthesisUtterance): void;
  cancel(): void;
}

/** A Speaker on the browser's speechSynthesis, or the silent one where it isn't available. */
export function browserSpeaker(
  synth: SpeechSynthesisLike | undefined = globalThis.speechSynthesis,
  makeUtterance: (text: string) => SpeechSynthesisUtterance = (text) => new SpeechSynthesisUtterance(text),
): Speaker {
  if (!synth) return silentSpeaker;
  return {
    speak(text) {
      synth.cancel(); // never talk over the previous coaching
      synth.speak(makeUtterance(text));
    },
    stop() {
      synth.cancel();
    },
  };
}

/** Coaching as one passage to read out. */
export function coachingSpeech(c: Coaching): string {
  const parts = [c.headline];
  if (c.wentWell.length) parts.push(`What went well. ${c.wentWell.join(' ')}`);
  if (c.fixThis.length) parts.push(`Fix this. ${c.fixThis.join(' ')}`);
  parts.push(`Next time. ${c.nextExercise}`);
  return parts.join(' ');
}
