import { ruleBasedCoaching } from './rules';
import type { CoachResponse, FallbackReason, SessionReport } from './types';
import { cleanCoaching, isCoaching } from './validate';

export const COACH_ENDPOINT = '/api/coach';
/** The server gives up on Claude after 10 s; allow a little more for the round trip. */
export const CLIENT_TIMEOUT_MS = 15_000;

const REASONS: readonly FallbackReason[] = ['no-key', 'timeout', 'invalid-response', 'api-rejected', 'bad-key', 'api-error', 'unreachable'];
const MAX_DETAIL = 300;

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
    const { source, coaching, reason, detail } = body as Record<string, unknown>;
    if ((source !== 'claude' && source !== 'rules') || !isCoaching(coaching)) return rules('invalid-response');
    const fallback = source === 'rules' && REASONS.includes(reason as FallbackReason);
    return {
      source,
      coaching: cleanCoaching(coaching),
      ...(fallback ? { reason: reason as FallbackReason } : {}),
      ...(fallback && typeof detail === 'string' && detail.trim() ? { detail: detail.trim().slice(0, MAX_DETAIL) } : {}),
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
    case 'api-rejected':
      return 'The Claude API rejected the request (a parameter or the model name), so these are the quick tips. The server console has the full error.';
    case 'bad-key':
      return 'The Claude API rejected the key in .env (ANTHROPIC_API_KEY), so these are the quick tips.';
    case 'api-error':
      return "Couldn't reach Claude (network, rate limit or a server error), so these are the quick tips.";
    case 'unreachable':
      return 'The coach server is not running (start it with npm run dev), so these are the quick tips.';
    default:
      return '';
  }
}

/** Short reason shown next to the "Quick tips" heading, so a key problem reads differently from a request problem. */
export function fallbackLabel(reason: FallbackReason | undefined): string {
  switch (reason) {
    case 'no-key':
      return 'Claude coach off: no API key';
    case 'timeout':
      return 'Claude coach unavailable: it took too long';
    case 'invalid-response':
      return "Claude coach unavailable: its answer didn't make sense";
    case 'api-rejected':
      return 'Claude coach unavailable: API rejected the request. See server console.';
    case 'bad-key':
      return 'Claude coach unavailable: API key rejected. Check .env.';
    case 'api-error':
      return 'Claude coach unavailable: API error. See server console.';
    case 'unreachable':
      return 'Claude coach unavailable: coach server not running';
    default:
      return 'rule-based, works offline';
  }
}
