import { PADS } from '../input/types';
import { SCHEMA_VERSION, type PassRecord, type SessionRecord, type StoredHit } from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const PAD_SET = new Set<string>(PADS);

/**
 * A stored or imported session record in the current shape, or null if it can't be read. Each
 * schema version gets a step here that turns it into the next one; version 1 is the first.
 */
export function migrateSession(raw: unknown): SessionRecord | null {
  if (!isObj(raw)) return null;
  const version = raw.schemaVersion;
  if (!isNum(version) || version < 1 || version > SCHEMA_VERSION) return null;
  // (Later versions: `if (version === 1) raw = fromV1(raw);` and so on, up to SCHEMA_VERSION.)
  return isSessionRecord(raw) ? raw : null;
}

/** Shape check for the current version. Report and coaching are only checked to be objects. */
export function isSessionRecord(v: unknown): v is SessionRecord {
  if (!isObj(v)) return false;
  return (
    v.schemaVersion === SCHEMA_VERSION &&
    isStr(v.id) && v.id.length > 0 &&
    isNum(v.startedAt) && isNum(v.endedAt) && isNum(v.playMs) && v.playMs >= 0 &&
    isStr(v.lessonId) && isStr(v.lessonTitle) &&
    (v.category === 'beat' || v.category === 'fill' || v.category === 'song') &&
    isNum(v.defaultBpm) &&
    (v.mode === 'practice' || v.mode === 'trainer' || v.mode === 'listen' || v.mode === 'record') &&
    (v.source === 'keyboard' || v.source === 'midi' || v.source === 'test' || v.source === 'none') &&
    Array.isArray(v.passes) && v.passes.every(isPassRecord) &&
    (v.trainer === null || isTrainer(v.trainer)) &&
    (v.report === null || isObj(v.report)) &&
    (v.coaching === null || isObj(v.coaching)) &&
    (v.bestPass === null || isBestPass(v.bestPass, v.passes.length))
  );
}

function isPassRecord(v: unknown): v is PassRecord {
  if (!isObj(v) || !isObj(v.counts)) return false;
  const c = v.counts;
  return (
    isNum(v.bpm) && isNumOrNull(v.focusAccuracy) && isNumOrNull(v.accuracy) && isNumOrNull(v.meanMs) && isNumOrNull(v.spreadMs) &&
    typeof v.clean === 'boolean' &&
    ['expected', 'hit', 'wrongPad', 'missed', 'extra', 'perfect', 'good', 'early', 'late'].every((k) => isNum(c[k]))
  );
}

function isTrainer(v: unknown): boolean {
  return isObj(v) && isNum(v.startBpm) && isNum(v.targetBpm) && isNumOrNull(v.highestCleanBpm) && typeof v.learned === 'boolean';
}

function isBestPass(v: unknown, passCount: number): boolean {
  if (!isObj(v) || !isObj(v.lesson)) return false;
  const l = v.lesson;
  return (
    isNum(v.pass) && Number.isInteger(v.pass) && v.pass >= 0 && v.pass < passCount &&
    isNum(v.bpm) && isNum(v.lengthMs) &&
    isStr(l.title) && isNum(l.beatsPerBar) && isNum(l.bars) && isStr(l.text) && isStr(l.subdivision) &&
    (l.focus === null || isObj(l.focus)) &&
    (l.equivalentPads === null || Array.isArray(l.equivalentPads)) &&
    (l.section === null || (isObj(l.section) && isNum(l.section.firstBar) && isNum(l.section.totalBars))) &&
    Array.isArray(v.hits) && v.hits.every(isStoredHit)
  );
}

function isStoredHit(v: unknown): v is StoredHit {
  return isObj(v) && isStr(v.pad) && PAD_SET.has(v.pad) && isNum(v.velocity) && isNum(v.t);
}
