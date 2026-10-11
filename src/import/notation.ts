import { LessonParseError, parseLessonText } from '../lessons';
import type { RecordSubdivision } from '../record/quantize';
import type { ImportConfidence, ImportDraft } from './draft';

export const IMPORT_NOTATION_ENDPOINT = '/api/import-notation';

/** Image types accepted (what the API reads and what the picker offers). */
export const NOTATION_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type NotationMediaType = (typeof NOTATION_MEDIA_TYPES)[number];

/** Longest edge sent to the API, px. Bigger images are downscaled in the browser first. */
export const MAX_IMAGE_EDGE = 1568;

/** What Claude returns for a notation image (the JSON schema output). */
export interface NotationReply {
  title: string;
  bpm: number;
  beatsPerBar: number;
  grid: RecordSubdivision;
  text: string;
  confidence: ImportConfidence;
  /** Anything uncertain, e.g. "couldn't tell if bar 2 beat 4 is tom 2 or tom 3". */
  notes: string;
}

export const NOTATION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    bpm: { type: 'number' },
    beatsPerBar: { type: 'integer' },
    grid: { type: 'string', enum: ['sixteenth', 'triplet'] },
    text: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    notes: { type: 'string' },
  },
  required: ['title', 'bpm', 'beatsPerBar', 'grid', 'text', 'confidence', 'notes'],
  additionalProperties: false,
} as const;

export type NotationFailure = 'no-key' | 'timeout' | 'parse-failed' | 'invalid-response' | 'api-rejected' | 'bad-key' | 'api-error' | 'unreachable' | 'bad-request';

export type NotationImportResponse =
  | { ok: true; reply: NotationReply; retried: boolean }
  /** `reply` is set for 'parse-failed': the text still didn't parse after one retry, but can be fixed by hand. */
  | { ok: false; reason: NotationFailure; message: string; reply?: NotationReply };

const MAX_TEXT = 20_000;
const MAX_LINE = 2_000;

/** True if `v` has exactly the reply shape with sensible values. Doesn't check that the text parses. */
export function isNotationReply(v: unknown): v is NotationReply {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).sort().join(',') !== 'beatsPerBar,bpm,confidence,grid,notes,text,title') return false;
  return (
    typeof o.title === 'string' && o.title.length <= 200 &&
    typeof o.bpm === 'number' && Number.isFinite(o.bpm) &&
    typeof o.beatsPerBar === 'number' && Number.isInteger(o.beatsPerBar) && o.beatsPerBar >= 1 && o.beatsPerBar <= 16 &&
    (o.grid === 'sixteenth' || o.grid === 'triplet') &&
    typeof o.text === 'string' && o.text.trim().length > 0 && o.text.length <= MAX_TEXT &&
    (o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low') &&
    typeof o.notes === 'string' && o.notes.length <= MAX_LINE
  );
}

/** Null if the reply's text parses on its own grid and has notes, otherwise the parse error. */
export function notationParseError(reply: NotationReply): string | null {
  try {
    const { notes } = parseLessonText(reply.text, { beatsPerBar: reply.beatsPerBar, subdivision: reply.grid });
    return notes.length === 0 ? 'The text has no notes (every step is a rest).' : null;
  } catch (error) {
    if (error instanceof LessonParseError) return error.message;
    throw error;
  }
}

/** A reply as a review draft. A tempo outside 30-300 (or missing from the image) becomes 80. */
export function notationDraft(reply: NotationReply): ImportDraft {
  const bpm = reply.bpm >= 30 && reply.bpm <= 300 ? Math.round(reply.bpm) : 80;
  return {
    origin: 'image',
    title: reply.title.trim() || 'Imported fill',
    bpm,
    beatsPerBar: reply.beatsPerBar,
    subdivision: reply.grid,
    text: reply.text.trim(),
    landing: false,
    confidence: reply.confidence,
    uncertain: reply.notes.trim(),
    warnings: [],
  };
}

/** Plain words for why an image import failed. */
export function notationFailureMessage(reason: NotationFailure): string {
  switch (reason) {
    case 'no-key':
      return 'Image import needs an Anthropic API key in .env.';
    case 'timeout':
      return 'Reading the image took too long (over 30 s). Try a tighter crop, or try again.';
    case 'parse-failed':
      return "Claude's transcription didn't fit the lesson format, even after one correction. Fix the text below by hand, or try a clearer image.";
    case 'invalid-response':
      return "Claude's answer didn't have the expected shape. Try again.";
    case 'api-rejected':
      return 'The Claude API rejected the request (a parameter, the model name, or the image). The server console has the full error.';
    case 'bad-key':
      return 'The Claude API rejected the key in .env (ANTHROPIC_API_KEY).';
    case 'api-error':
      return 'The Claude API had a problem. Try again in a moment.';
    case 'unreachable':
      return "Couldn't reach the import server. Image import only works with `npm run dev`.";
    case 'bad-request':
      return 'The image could not be sent (wrong type or too large).';
  }
}
