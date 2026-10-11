import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isCustomLessonData, readLegacyLessons, removeLegacyLessons, type CustomLessonData, type LessonBackend, type StorageLike } from '../record/customLessons';
import type { CoachResponse } from '../coach/types';
import { SCHEMA_VERSION, type SessionRecord } from './types';
import { migrateSession } from './validate';

export const DB_NAME = 'drumly';
/** IndexedDB's own version: bump it to add stores or indexes (see `upgrade`). */
export const DB_VERSION = 1;

export interface DrumlyDB extends DBSchema {
  sessions: { key: string; value: SessionRecord; indexes: { byLesson: string; byStart: number } };
  lessons: { key: string; value: CustomLessonData };
  meta: { key: string; value: unknown };
}

export type DrumlyDatabase = IDBPDatabase<DrumlyDB>;

/** Create or update the stores. Each block upgrades from one version to the next. */
export function openDrumlyDb(name = DB_NAME): Promise<DrumlyDatabase> {
  return openDB<DrumlyDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
        sessions.createIndex('byLesson', 'lessonId');
        sessions.createIndex('byStart', 'startedAt');
        db.createObjectStore('lessons', { keyPath: 'id' });
        db.createObjectStore('meta');
      }
    },
  });
}

/** How the move of custom lessons from localStorage went (once per browser). */
export type LegacyMigration = 'none' | 'migrated' | 'failed';

export interface HistoryStoreOptions {
  /** Opens the database. Default: IndexedDB via `idb`. Rejecting (or throwing) means storage is unavailable. */
  open?: () => Promise<DrumlyDatabase>;
  /** Where lessons saved by earlier versions live. Default: none. */
  legacyStorage?: () => StorageLike | null;
  /** Called once when storage stops working (or never worked), so the page can say so. */
  onUnavailable?: (error: unknown) => void;
}

/**
 * Sessions, custom lessons and a little metadata in IndexedDB. Every call is wrapped: if
 * IndexedDB is unavailable (a private window, blocked storage) or a call fails, the store keeps
 * working in memory for this page session, `available` turns false, and `onUnavailable` fires once.
 */
export class HistoryStore implements LessonBackend {
  private db: DrumlyDatabase | null;
  /** This page session's data when the database isn't there. */
  private readonly memSessions = new Map<string, SessionRecord>();
  private readonly memLessons = new Map<string, CustomLessonData>();
  private reported = false;

  private constructor(
    db: DrumlyDatabase | null,
    private readonly onUnavailable: ((error: unknown) => void) | undefined,
    /** Lessons as loaded at startup (database plus anything still waiting in localStorage). */
    readonly initialLessons: readonly CustomLessonData[],
    readonly migration: LegacyMigration,
  ) {
    this.db = db;
  }

  get available(): boolean {
    return this.db !== null;
  }

  /** Open the database, move any lessons saved in localStorage into it, and load the lessons. Never throws. */
  static async open(options: HistoryStoreOptions = {}): Promise<HistoryStore> {
    let db: DrumlyDatabase | null = null;
    let openError: unknown = null;
    try {
      db = await (options.open ?? (() => openDrumlyDb()))();
    } catch (error) {
      openError = error;
    }
    const legacy = options.legacyStorage ? readLegacyLessons(options.legacyStorage) : { items: [], found: false };
    let migration: LegacyMigration = 'none';
    let lessons: CustomLessonData[] = [];
    if (db) {
      try {
        if (legacy.found) {
          migration = (await migrateLegacyLessons(db, legacy.items)) ? 'migrated' : 'failed';
          // Remove the old key only once every lesson is safely in IndexedDB.
          if (migration === 'migrated') removeLegacyLessons(options.legacyStorage!);
        }
        await db.put('meta', SCHEMA_VERSION, 'schemaVersion');
        lessons = (await db.getAll('lessons')).filter(isCustomLessonData);
      } catch (error) {
        db = null;
        openError = error;
      }
    }
    // Lessons that couldn't be moved stay in localStorage and are still shown.
    const ids = new Set(lessons.map((l) => l.id));
    if (!db || migration === 'failed') lessons = [...lessons, ...legacy.items.filter((l) => !ids.has(l.id))];
    const store = new HistoryStore(db, options.onUnavailable, lessons, migration);
    for (const l of lessons) if (!db) store.memLessons.set(l.id, l);
    if (!db) store.fail(openError);
    return store;
  }

  // ---- sessions ----------------------------------------------------------

  /** Save (or replace, by id). Resolves to false if it only lives in memory. */
  saveSession(record: SessionRecord): Promise<boolean> {
    return this.write((db) => db.put('sessions', record), () => this.memSessions.set(record.id, record));
  }

  /** Attach coaching that arrived after the session was saved (the "Get coaching" answer). */
  async updateCoaching(id: string, coaching: CoachResponse): Promise<boolean> {
    const current = (await this.getSession(id)) ?? null;
    if (!current) return false;
    return this.saveSession({ ...current, coaching });
  }

  async getSession(id: string): Promise<SessionRecord | undefined> {
    const raw = await this.read((db) => db.get('sessions', id), () => this.memSessions.get(id));
    return raw ? (migrateSession(raw) ?? undefined) : undefined;
  }

  /** Every session, newest first. Records that can't be read are skipped. */
  async listSessions(): Promise<SessionRecord[]> {
    const raw = await this.read((db) => db.getAllFromIndex('sessions', 'byStart'), () => [...this.memSessions.values()]);
    return readable(raw).sort((a, b) => b.startedAt - a.startedAt);
  }

  /** One lesson's sessions, newest first. */
  async sessionsForLesson(lessonId: string): Promise<SessionRecord[]> {
    const raw = await this.read(
      (db) => db.getAllFromIndex('sessions', 'byLesson', lessonId),
      () => [...this.memSessions.values()].filter((s) => s.lessonId === lessonId),
    );
    return readable(raw).sort((a, b) => b.startedAt - a.startedAt);
  }

  // ---- custom lessons (LessonBackend) -----------------------------------------

  put(data: CustomLessonData): Promise<boolean> {
    return this.write((db) => db.put('lessons', data), () => this.memLessons.set(data.id, data));
  }

  delete(id: string): Promise<boolean> {
    return this.write((db) => db.delete('lessons', id), () => this.memLessons.delete(id));
  }

  async listLessons(): Promise<CustomLessonData[]> {
    const raw = await this.read((db) => db.getAll('lessons'), () => [...this.memLessons.values()]);
    return raw.filter(isCustomLessonData);
  }

  /**
   * Merge sessions and lessons in by id (an existing id is replaced, never duplicated), all in one
   * transaction. Resolves to false if it only lives in memory.
   */
  importAll(sessions: readonly SessionRecord[], lessons: readonly CustomLessonData[]): Promise<boolean> {
    return this.write(
      async (db) => {
        const tx = db.transaction(['sessions', 'lessons'], 'readwrite');
        await Promise.all([...sessions.map((s) => tx.objectStore('sessions').put(s)), ...lessons.map((l) => tx.objectStore('lessons').put(l)), tx.done]);
      },
      () => {
        for (const s of sessions) this.memSessions.set(s.id, s);
        for (const l of lessons) this.memLessons.set(l.id, l);
      },
    );
  }

  // ---- plumbing -------------------------------------------------------------

  /** Write to the database, or to memory if it's unavailable or the write fails. */
  private async write(op: (db: DrumlyDatabase) => Promise<unknown>, inMemory: () => void): Promise<boolean> {
    if (this.db) {
      try {
        await op(this.db);
        return true;
      } catch (error) {
        this.fail(error);
      }
    }
    inMemory();
    return false;
  }

  private async read<T>(op: (db: DrumlyDatabase) => Promise<T>, inMemory: () => T): Promise<T> {
    if (this.db) {
      try {
        return await op(this.db);
      } catch (error) {
        this.fail(error);
      }
    }
    return inMemory();
  }

  private fail(error: unknown): void {
    this.db = null;
    if (this.reported) return;
    this.reported = true;
    console.warn('History storage is unavailable; keeping this session in memory only.', error);
    this.onUnavailable?.(error);
  }
}

function readable(raw: readonly unknown[]): SessionRecord[] {
  return raw.map(migrateSession).filter((s): s is SessionRecord => s !== null);
}

/**
 * Copy lessons from localStorage into IndexedDB in one transaction. Existing ids in IndexedDB win.
 * If anything fails the transaction is aborted, so nothing is half-moved, and it resolves to false.
 */
export async function migrateLegacyLessons(db: DrumlyDatabase, items: readonly CustomLessonData[]): Promise<boolean> {
  const tx = db.transaction('lessons', 'readwrite');
  // Aborting rejects tx.done; that's expected here and handled by the return value.
  const done = tx.done.catch(() => false as const);
  try {
    for (const item of items) {
      if ((await tx.store.getKey(item.id)) === undefined) await tx.store.put(item);
    }
    return (await done) !== false;
  } catch {
    try {
      tx.abort();
    } catch {
      // already finished or aborted
    }
    await done;
    return false;
  }
}
