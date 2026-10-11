import { SCHEMA_VERSION, type PassRecord, type SessionRecord } from './types';

/** A pass record for tests. */
export function pass(overrides: Partial<PassRecord> = {}): PassRecord {
  return {
    bpm: 100,
    focusAccuracy: 90,
    accuracy: 95,
    meanMs: -4,
    spreadMs: 12,
    counts: { expected: 20, hit: 18, wrongPad: 1, missed: 1, extra: 0, perfect: 10, good: 6, early: 1, late: 1 },
    clean: true,
    ...overrides,
  };
}

/** A session record for tests: lesson "rock-1" at a 100 BPM default, one clean pass, 2 minutes played. */
export function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 's1',
    startedAt: new Date(2026, 9, 10, 18, 0).getTime(),
    endedAt: new Date(2026, 9, 10, 18, 2).getTime(),
    playMs: 120_000,
    lessonId: 'rock-1',
    lessonTitle: 'Rock beat',
    category: 'beat',
    defaultBpm: 100,
    mode: 'practice',
    source: 'keyboard',
    passes: [pass()],
    trainer: null,
    report: null,
    coaching: null,
    bestPass: null,
    ...overrides,
  };
}
