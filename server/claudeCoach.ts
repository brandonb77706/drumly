import Anthropic from '@anthropic-ai/sdk';
import { cleanCoaching, isCoaching, ruleBasedCoaching, type CoachResponse, type FallbackReason, type SessionReport } from '../src/coach';

export const DEFAULT_COACH_MODEL = 'claude-haiku-5-5';
export const COACH_TIMEOUT_MS = 10_000;

export interface CoachConfig {
  /** From ANTHROPIC_API_KEY in .env. Without it, the rule-based coach answers. */
  apiKey?: string | undefined;
  /** From COACH_MODEL in .env. */
  model?: string | undefined;
  timeoutMs?: number;
  /** For tests. */
  createClient?: (apiKey: string) => Pick<Anthropic, 'messages'>;
}

export const SYSTEM_PROMPT = `You are a friendly, direct drum teacher talking to your student right after a practice session on an electronic kit.
You get a JSON report of the session. Every claim you make must come from the report's numbers. Never invent a problem the report doesn't show, and never mention left or right hands (the kit can't tell them apart).

How to read the report:
- Times are milliseconds. Negative meanMs means early (rushing), positive means late (dragging). spreadMs is the timing spread: lower is steadier.
- "graded" says whether accuracy covers just the fill or the whole lesson. "fill" and "groove" split the timing for lessons with a fill.
- problemSpots are notes that went wrong in several passes, with drummer counting ("the 'e' of beat 4").
- trainer.learned means the player reached the target tempo cleanly. lesson.next is the next lesson to suggest.

Reply with:
- headline: one short sentence. If trainer.learned is true but problemSpots is not empty, say it was learned and that there is a spot to clean up (for example "Fill learned at 65 BPM. One spot to clean up."), not just "nice work".
- wentWell: 1 to 3 short items. Never repeat what the headline already says (for example, don't say again that it was learned at that tempo).
- fixThis: 0 to 2 short items, the most important first. Empty if nothing in the report needs fixing.
- nextExercise: one specific exercise for next time, with a tempo. If problemSpots is not empty, it must drill the worst one (the first) first: loop just the beats around it about 10 BPM slower until that note is clean 3 times in a row, then play the full fill. Only suggest moving on to lesson.next when problemSpots is empty.
Talk like a teacher: plain words, short sentences, no jargon, no emoji. Keep the whole reply under 120 words.`;

const COACHING_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    wentWell: { type: 'array', items: { type: 'string' } },
    fixThis: { type: 'array', items: { type: 'string' } },
    nextExercise: { type: 'string' },
  },
  required: ['headline', 'wentWell', 'fixThis', 'nextExercise'],
  additionalProperties: false,
} as const;

class CoachTimeout extends Error {}

/** Longest API error message passed on to the browser. */
const MAX_DETAIL = 300;

/**
 * Sort an API failure by what the user has to fix: the key (401, 403), the request itself (400,
 * 404 for an unknown model, 422: a parameter the model doesn't accept), or neither (429, 5xx, network).
 */
export function apiFailureReason(status: number | undefined): FallbackReason {
  if (status === 401 || status === 403) return 'bad-key';
  if (status === 400 || status === 404 || status === 422) return 'api-rejected';
  return 'api-error';
}

/**
 * Coaching for a session report: Claude if a key is configured and it answers in time with the
 * right shape, otherwise the rule-based coaching with `source: 'rules'` and the reason.
 */
export async function coachReport(report: SessionReport, config: CoachConfig): Promise<CoachResponse> {
  const rules = (reason: FallbackReason): CoachResponse => ({ source: 'rules', coaching: ruleBasedCoaching(report), reason });
  const apiKey = config.apiKey?.trim();
  if (!apiKey) return rules('no-key');

  const timeoutMs = config.timeoutMs ?? COACH_TIMEOUT_MS;
  const client = config.createClient ? config.createClient(apiKey) : new Anthropic({ apiKey, maxRetries: 0, timeout: timeoutMs });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CoachTimeout());
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      client.messages.create(
        {
          model: config.model?.trim() || DEFAULT_COACH_MODEL,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: COACHING_SCHEMA } },
          messages: [{ role: 'user', content: `Session report:\n${JSON.stringify(report)}` }],
        },
        { signal: controller.signal },
      ),
      timeout,
    ]);
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return rules('invalid-response');
    const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    const parsed = parseJson(text);
    if (!isCoaching(parsed)) return rules('invalid-response');
    return { source: 'claude', coaching: cleanCoaching(parsed) };
  } catch (error) {
    if (error instanceof CoachTimeout || error instanceof Anthropic.APIConnectionTimeoutError) return rules('timeout');
    if (error instanceof Anthropic.APIUserAbortError) return rules('timeout');
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof Anthropic.APIError ? error.status : undefined;
    console.warn(`[coach] Claude call failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
    const reason = apiFailureReason(status);
    // The API's message says which parameter or key was wrong; pass it on so the UI can show it.
    return reason === 'api-error' ? rules(reason) : { ...rules(reason), detail: message.slice(0, MAX_DETAIL) };
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
