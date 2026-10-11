export * from './types';
export { buildSessionReport, nextLesson, trend, tendencyOf, TENDENCY_MS, TREND_POINTS } from './report';
export { ruleBasedCoaching, spotDrill, RUSH_MS, LOOSE_SPREAD_MS, STEADY_SPREAD_MS, SLOW_DOWN_BPM } from './rules';
export { isCoaching, isSessionReport, cleanCoaching } from './validate';
export { browserSpeaker, silentSpeaker, coachingSpeech } from './speech';
export type { Speaker, SpeechSynthesisLike } from './speech';
export { requestCoaching, fallbackNote, fallbackLabel, COACH_ENDPOINT } from './client';
