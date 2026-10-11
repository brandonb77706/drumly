import { ruleBasedCoaching } from './rules';
import type { CoachResponse, FallbackReason, SessionReport } from './types';
import { cleanCoaching, isCoaching } from './validate';

export const COACH_ENDPOINT = '/api/coach';
/** The server gives up on Claude after 10 s; allow a little more for the round trip. */
export const CLIENT_TIMEOUT_MS = 15_000;

const REASONS: readonly FallbackReason[] = ['no-key', 'timeout', 'invalid-response', 'api-error', 'unreachable'];

/**
 * Ask the local coach server. Always resolves: if the server is missing (e.g. a static build),
 * slow, or answers with something unexpected, the rule-based coaching comes back instead.
 */
export async function requestCoaching(report: SessionReport, fetchFn: typeof fetch = fetch, timeoutMs = CLIENT_TIMEOUT_MS): Promise<CoachResponse> {
  const rules = (reason: FallbackReason): CoachResponse => ({ source: 'rules', coaching: ruleBasedCoaching(report), reason });
  const controller = new AbortController();
  // A network timeout, not timing or sound, so a timer is fine here.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(COACH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report }),
      signal: controller.signal,
    });
    if (!res.ok) return rules('unreachable');
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return rules('invalid-response');
    const { source, coaching, reason } = body as Record<string, unknown>;
    if ((source !== 'claude' && source !== 'rules') || !isCoaching(coaching)) return rules('invalid-response');
    return {
      source,
      coaching: cleanCoaching(coaching),
      ...(source === 'rules' && REASONS.includes(reason as FallbackReason) ? { reason: reason as FallbackReason } : {}),
    };
  } catch {
    return rules(controller.signal.aborted ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/** Plain words for why the Claude coach wasn't used. */
export function fallbackNote(reason: FallbackReason | undefined): string {
  switch (reason) {
    case 'no-key':
      return 'The Claude coach is off (no ANTHROPIC_API_KEY in .env), so these are the quick tips.';
    case 'timeout':
      return 'The Claude coach took too long, so these are the quick tips.';
    case 'invalid-response':
      return "The Claude coach's answer didn't make sense, so these are the quick tips.";
    case 'api-error':
      return "Couldn't reach Claude, so these are the quick tips.";
    case 'unreachable':
      return 'The coach server is not running (start it with npm run dev), so these are the quick tips.';
    default:
      return '';
  }
}
