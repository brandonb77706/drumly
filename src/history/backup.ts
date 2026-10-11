import { customLesson, isCustomLessonData, type CustomLessonData } from '../record/customLessons';
import { SCHEMA_VERSION, type HistorySettings, type SessionRecord } from './types';
import { migrateSession } from './validate';

export const HISTORY_FORMAT = 'drumly-history';

/** The "Export history" file. */
export interface HistoryFile {
  readonly format: typeof HISTORY_FORMAT;
  readonly schemaVersion: number;
  readonly exportedAt: string;
  readonly sessions: readonly SessionRecord[];
  readonly lessons: readonly CustomLessonData[];
  readonly settings: HistorySettings;
}

/** The export file's content: sessions oldest first and lessons by id, so the same history always gives the same file. */
export function buildHistoryFile(sessions: readonly SessionRecord[], lessons: readonly CustomLessonData[], settings: HistorySettings, now: Date): HistoryFile {
  return {
    format: HISTORY_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    sessions: [...sessions].sort((a, b) => a.startedAt - b.startedAt || cmp(a.id, b.id)),
    lessons: [...lessons].sort((a, b) => cmp(a.id, b.id)),
    settings,
  };
}

/** "drumly-history-2026-10-11.json" */
export function historyFileName(now: Date): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `drumly-history-${d}.json`;
}

export type ParsedHistory = { ok: true; file: HistoryFile } | { ok: false; message: string };

/**
 * Read an "Export history" file. The whole file is rejected, with a message saying why, if it
 * isn't one, comes from a newer version, or any session or lesson in it is damaged.
 */
export function parseHistoryFile(text: string): ParsedHistory {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "This isn't a Drumly history file (it isn't valid JSON)." };
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== HISTORY_FORMAT) {
    return { ok: false, message: "This isn't a Drumly history file. Use a file made with Export history." };
  }
  const r = raw as Record<string, unknown>;
  const version = r.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { ok: false, message: 'This history file has no valid schema version.' };
  }
  if (version > SCHEMA_VERSION) {
    return { ok: false, message: `This history file was made by a newer version of Drumly (schema ${version}; this one reads up to ${SCHEMA_VERSION}).` };
  }
  if (!Array.isArray(r.sessions) || !Array.isArray(r.lessons)) {
    return { ok: false, message: 'This history file is damaged: it has no session or lesson list.' };
  }
  const sessions: SessionRecord[] = [];
  for (const [i, s] of r.sessions.entries()) {
    const session = migrateSession(s);
    if (!session) return { ok: false, message: `This history file is damaged: session ${i + 1} of ${r.sessions.length} can't be read. Nothing was imported.` };
    sessions.push(session);
  }
  const lessons: CustomLessonData[] = [];
  for (const [i, l] of r.lessons.entries()) {
    if (!isCustomLessonData(l) || !parses(l)) {
      return { ok: false, message: `This history file is damaged: lesson ${i + 1} of ${r.lessons.length} can't be read. Nothing was imported.` };
    }
    lessons.push(l);
  }
  return {
    ok: true,
    file: {
      format: HISTORY_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: typeof r.exportedAt === 'string' ? r.exportedAt : '',
      sessions,
      lessons,
      settings: readSettings(r.settings),
    },
  };
}

/** Known settings with the right types; anything else is dropped. */
export function readSettings(raw: unknown): HistorySettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: { -readonly [K in keyof HistorySettings]: HistorySettings[K] } = {};
  if (typeof r.clickMode === 'string') out.clickMode = r.clickMode;
  if (typeof r.hitSounds === 'string') out.hitSounds = r.hitSounds;
  const inRange = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (inRange(r.drumsVolume, 0, 100)) out.drumsVolume = r.drumsVolume;
  if (inRange(r.clickVolume, 0, 100)) out.clickVolume = r.clickVolume;
  if (typeof r.guideDrums === 'boolean') out.guideDrums = r.guideDrums;
  if (typeof r.coachSpeak === 'boolean') out.coachSpeak = r.coachSpeak;
  if (inRange(r.speed, 0.05, 4)) out.speed = r.speed;
  if (typeof r.lessonId === 'string' && r.lessonId !== '') out.lessonId = r.lessonId;
  if (typeof r.loop === 'boolean') out.loop = r.loop;
  if (typeof r.trainer === 'boolean') out.trainer = r.trainer;
  if (typeof r.listen === 'boolean') out.listen = r.listen;
  if (inRange(r.trainerStepBpm, 1, 50)) out.trainerStepBpm = r.trainerStepBpm;
  if (inRange(r.trainerPassThreshold, 1, 100)) out.trainerPassThreshold = r.trainerPassThreshold;
  if (inRange(r.trainerPassesNeeded, 1, 10)) out.trainerPassesNeeded = Math.round(r.trainerPassesNeeded);
  if (r.tab === 'practice' || r.tab === 'progress') out.tab = r.tab;
  if (r.progressLesson === null || (typeof r.progressLesson === 'string' && r.progressLesson !== '')) out.progressLesson = r.progressLesson;
  return out;
}

/** What an import would add, for the confirmation: how many are new and how many are already here. */
export function importCounts(file: HistoryFile, existingSessionIds: ReadonlySet<string>, existingLessonIds: ReadonlySet<string>) {
  const newSessions = file.sessions.filter((s) => !existingSessionIds.has(s.id)).length;
  const newLessons = file.lessons.filter((l) => !existingLessonIds.has(l.id)).length;
  return { sessions: file.sessions.length, lessons: file.lessons.length, newSessions, newLessons };
}

function parses(data: CustomLessonData): boolean {
  try {
    customLesson(data);
    return true;
  } catch {
    return false;
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
