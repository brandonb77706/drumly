import Anthropic from '@anthropic-ai/sdk';
import {
  NOTATION_SCHEMA,
  isNotationReply,
  notationParseError,
  type NotationFailure,
  type NotationImportResponse,
  type NotationMediaType,
  type NotationReply,
} from '../src/import/notation';
import { apiFailureReason } from './claudeCoach';

/** Reading notation needs a stronger model than coaching. IMPORT_MODEL in .env overrides it. */
export const DEFAULT_IMPORT_MODEL = 'claude-sonnet-5-5';
/** For the whole import, the retry included. */
export const IMPORT_TIMEOUT_MS = 30_000;

export interface ImportConfig {
  /** From ANTHROPIC_API_KEY in .env. */
  apiKey?: string | undefined;
  /** From IMPORT_MODEL in .env. */
  model?: string | undefined;
  timeoutMs?: number;
}

export interface NotationImage {
  mediaType: NotationMediaType;
  /** Base64, no data: prefix. */
  data: string;
}

export const IMPORT_SYSTEM_PROMPT = `You transcribe drum notation from an image (a page of a drum book, a website, or notation shown in a lesson video) into a drum practice app's text format.

How to read standard drum notation (a 5-line percussion staff, lines counted from the bottom):
- Kick (bass drum): the bottom space (between lines 1 and 2).
- Floor tom: the space between lines 2 and 3.
- Snare: the space between lines 3 and 4 (the middle of the staff). A cross-stick or rim click is usually an x or circled x there.
- Tom 2 (mid tom): on line 4. Tom 1 (high tom): the top space (between lines 4 and 5).
- Hi-hat: an x above the top line (on the space above the staff). An x with a small "o" above it is an open hi-hat. An x below the staff (under line 1) is the hi-hat pedal.
- Ride: an x on the top line. A diamond notehead or "bell" marking on the ride is the ride bell.
- Crash: an x on a ledger line above the staff (often with an accent).
- Some books use their own key (a legend at the top of the page). If the image shows one, follow it.
- Noteheads: filled or x heads are hits. Beams and flags give the rhythm: one beam = 8ths, two beams = 16ths. A "3" over a beamed group is a triplet.
- Rests: count them as silent steps. A quarter rest fills a whole beat.
- Accents (>) mark louder hits. Ghost notes in parentheses are quiet hits: write them as normal hits.
- Repeat signs (a bar with ||: :|| or a one-bar repeat %) mean the bar is played again: write the repeated bars out in full.
- If a tempo marking is shown (a quarter note = 90), use it as bpm. Otherwise suggest a comfortable practice tempo (70 to 90).
- The time signature gives beatsPerBar (4/4 is 4, 3/4 is 3). Count beats in quarter notes.

The app's text format: one line per drum, one character per grid step, bars separated by " | ".
- grid "sixteenth": 4 steps per beat (1 e & a), so a 4/4 bar has 16 steps. Use it for 8ths and 16ths (an 8th note is x followed by -).
- grid "triplet": 3 steps per beat (1 trip let), so a 4/4 bar has 12 steps. Use it when the music is in triplets. Pick one grid for the whole transcription.
- x = hit, X = accented hit, - = rest.
- Drum names: CR crash, C2 crash 2, RD ride, RB ride bell, HH closed hi-hat, OH open hi-hat, HP hi-hat pedal, T1 high tom, T2 mid tom, SN snare, XS cross-stick, SR snare rim shot, T3 floor tom, KK kick.
- Every line must have exactly the same number of bars and steps. Only include drums that are played.

Example: a 2-bar 4/4 beat with a snare fill on beat 4 of bar 2, landing on nothing:
HH: x-x-x-x-x-x-x-x- | x-x-x-x-x-x-----
SN: ----x-------x--- | ----x-------xxxx
KK: x-------x------- | x-------x-------

Transcribe only what the image shows. Reply with JSON:
- title: a short name (from the image if it has one, otherwise describe it, e.g. "16th tom fill").
- bpm, beatsPerBar, grid, text: as above.
- confidence: "high" if the notation is clear and you are sure of every note, "medium" if a few notes are uncertain, "low" if the image is blurry, cropped, or not standard drum notation.
- notes: list every uncertain spot so the player can check it against the image, e.g. "Couldn't tell if bar 2 beat 4 is tom 2 or tom 3." Empty if nothing is uncertain.`;

const INSTRUCTION = 'Transcribe this drum notation into the text format.';

class ImportTimeout extends Error {}

/**
 * Transcribe a notation image with Claude. The returned text is checked with the app's own lesson
 * parser; if it doesn't parse, Claude gets the error once and is asked for a corrected version.
 * The whole import (both calls) has one 30 s deadline.
 */
export async function importNotation(image: NotationImage, config: ImportConfig): Promise<NotationImportResponse> {
  const fail = (reason: NotationFailure, message = '', reply?: NotationReply): NotationImportResponse => ({ ok: false, reason, message, ...(reply ? { reply } : {}) });
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return fail('no-key');

  const timeoutMs = config.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ImportTimeout());
    }, timeoutMs);
  });

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: INSTRUCTION },
      ],
    },
  ];
  const ask = async (): Promise<{ reply: NotationReply | null; content: Anthropic.ContentBlock[] }> => {
    const response = await Promise.race([
      client.messages.create(
        {
          model: config.model?.trim() || DEFAULT_IMPORT_MODEL,
          max_tokens: 8000,
          system: IMPORT_SYSTEM_PROMPT,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTATION_SCHEMA } },
          messages,
        },
        { signal: controller.signal },
      ),
      timeout,
    ]);
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return { reply: null, content: response.content };
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = parseJson(text);
    return { reply: isNotationReply(parsed) ? parsed : null, content: response.content };
  };

  try {
    const first = await ask();
    if (!first.reply) return fail('invalid-response');
    const error = notationParseError(first.reply);
    if (error === null) return { ok: true, reply: first.reply, retried: false };

    // One correction round: the reply as it was (append-only), then the parser's error.
    messages.push({ role: 'assistant', content: first.content });
    messages.push({
      role: 'user',
      content: `The app's lesson parser rejected that text:\n${error}\nSend the whole transcription again, corrected. Every line needs the same number of bars, ${first.reply.beatsPerBar} beats per bar, and ${first.reply.grid === 'triplet' ? 3 : 4} steps per beat.`,
    });
    const second = await ask();
    if (!second.reply) return fail('invalid-response');
    const again = notationParseError(second.reply);
    if (again === null) return { ok: true, reply: second.reply, retried: true };
    return fail('parse-failed', again, second.reply);
  } catch (error) {
    if (error instanceof ImportTimeout || error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) return fail('timeout');
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    console.warn(`[import] Claude call failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
    const reason = apiFailureReason(status);
    return fail(reason === 'api-rejected' ? 'api-rejected' : reason === 'bad-key' ? 'bad-key' : 'api-error', message.slice(0, 300));
  } finally {
    clearTimeout(timer);
  }
}

/** JSON from the reply, tolerating a ```json fence. Undefined if it doesn't parse. */
function parseJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}
