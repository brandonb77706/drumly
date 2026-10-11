import { describe, expect, it } from 'vitest';
import { browserSpeaker, coachingSpeech, silentSpeaker } from './speech';

describe('speech', () => {
  it('reads coaching as one passage', () => {
    expect(coachingSpeech({ headline: 'Nice work.', wentWell: ['Clean fill.'], fixThis: [], nextExercise: 'Try 65 BPM.' })).toBe(
      'Nice work. What went well. Clean fill. Next time. Try 65 BPM.',
    );
  });

  it('the browser speaker cancels before speaking; no speechSynthesis means silent', () => {
    const calls: string[] = [];
    const synth = { speak: (u: SpeechSynthesisUtterance) => calls.push(`speak:${(u as unknown as { text: string }).text}`), cancel: () => calls.push('cancel') };
    const speaker = browserSpeaker(synth, (text) => ({ text }) as unknown as SpeechSynthesisUtterance);
    speaker.speak('hello');
    speaker.stop();
    expect(calls).toEqual(['cancel', 'speak:hello', 'cancel']);
    expect(browserSpeaker(undefined)).toBe(silentSpeaker);
  });
});
