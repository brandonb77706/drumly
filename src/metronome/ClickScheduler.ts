import {
  clampBeatsPerBar,
  clampBpm,
  clickAt,
  secondsPerClick,
  type GridClick,
  type GridSegment,
  type Subdivision,
} from './timing';

export interface MetronomeSettings {
  bpm: number;
  beatsPerBar: number;
  subdivision: Subdivision;
  /** Accent beat 1 of each bar. */
  accent: boolean;
  /** Play one bar of quarter-note count-in before bar 0. Read at start(). */
  countIn: boolean;
}

export const DEFAULT_SETTINGS: MetronomeSettings = {
  bpm: 100,
  beatsPerBar: 4,
  subdivision: 'quarter',
  accent: true,
  countIn: false,
};

/**
 * Decides which clicks happen when. No audio and no timers: the caller asks for
 * "everything due before time X" and gets click descriptions back. Times are in
 * seconds on whatever clock start() was given (the AudioContext clock in practice).
 *
 * Setting changes are queued and committed at the next beat boundary that has not
 * been scheduled yet:
 * - BPM, subdivision and accent changes apply from the next beat. The gap leading
 *   into that beat already uses the new BPM, so in quarter-note mode the next click
 *   lands exactly one new interval after the last scheduled click.
 * - Beats-per-bar changes apply from the next bar, so a bar is never cut short.
 * Clicks already handed out are never moved, so a change can't cause a double click.
 */
export class ClickScheduler {
  private settings: MetronomeSettings;
  private segment: GridSegment | null = null;
  private nextIndex = 0;
  /** Most recently handed-out click; pending changes are committed relative to it. */
  private lastClick: GridClick | null = null;

  constructor(settings: Partial<MetronomeSettings> = {}) {
    this.settings = normalize({ ...DEFAULT_SETTINGS, ...settings });
  }

  getSettings(): MetronomeSettings {
    return { ...this.settings };
  }

  update(changes: Partial<MetronomeSettings>): void {
    this.settings = normalize({ ...this.settings, ...changes });
  }

  get isRunning(): boolean {
    return this.segment !== null;
  }

  /** Index of the next click that has not been scheduled yet. */
  get nextClickIndex(): number {
    return this.nextIndex;
  }

  start(startTime: number): void {
    const s = this.settings;
    this.nextIndex = 0;
    this.lastClick = null;
    this.segment = {
      startIndex: 0,
      startTime,
      bar: s.countIn ? -1 : 0,
      beat: 0,
      bpm: s.bpm,
      beatsPerBar: s.beatsPerBar,
      subdivision: s.subdivision,
      accent: s.accent,
      countIn: s.countIn,
    };
  }

  stop(): void {
    this.segment = null;
    this.lastClick = null;
  }

  /** Hand out every not-yet-scheduled click with time < horizon, in order. */
  scheduleUntil(horizon: number, maxClicks = 10_000): GridClick[] {
    const out: GridClick[] = [];
    while (this.segment && out.length < maxClicks) {
      // Commit lazily, right before computing the next click, so a change made at any
      // moment before that click is handed out still takes effect at this boundary.
      if (this.lastClick) this.commitAtBeatBoundary(this.lastClick);
      const click = clickAt(this.segment, this.nextIndex);
      if (click.time >= horizon) break;
      out.push(click);
      this.nextIndex++;
      this.lastClick = click;
    }
    return out;
  }

  /**
   * Preview the clicks scheduleUntil(horizon) would return if nothing else changed,
   * without consuming them. Pending setting changes are included.
   */
  peek(horizon: number, maxClicks = 100_000): GridClick[] {
    if (!this.segment) return [];
    const clone = new ClickScheduler(this.settings);
    clone.segment = { ...this.segment };
    clone.nextIndex = this.nextIndex;
    clone.lastClick = this.lastClick;
    return clone.scheduleUntil(horizon, maxClicks);
  }

  /**
   * If `click` (the last one handed out) ended a beat and settings differ from the current
   * segment, start a new segment at the next click. Idempotent: once the new segment matches
   * the settings, calling again changes nothing.
   */
  private commitAtBeatBoundary(click: GridClick): void {
    const seg = this.segment;
    if (!seg || click.subdivision !== click.subdivisionsPerBeat - 1) return;

    let nextBeat = click.beat + 1;
    let nextBar = click.bar;
    const barBoundary = nextBeat >= seg.beatsPerBar;
    if (barBoundary) {
      nextBeat = 0;
      nextBar++;
    }

    const s = this.settings;
    const leavingCountIn = seg.countIn && nextBar >= 0;
    const beatsPerBarChanged = barBoundary && s.beatsPerBar !== seg.beatsPerBar;
    const changed =
      s.bpm !== seg.bpm ||
      s.accent !== seg.accent ||
      (!seg.countIn && s.subdivision !== seg.subdivision) ||
      beatsPerBarChanged ||
      leavingCountIn;
    if (!changed) return;

    // The gap into the new beat: the old beat's subdivision at the new tempo.
    const gap = secondsPerClick(s.bpm, seg.countIn ? 'quarter' : seg.subdivision);
    this.segment = {
      startIndex: this.nextIndex,
      startTime: click.time + gap,
      bar: nextBar,
      beat: nextBeat,
      bpm: s.bpm,
      beatsPerBar: barBoundary ? s.beatsPerBar : seg.beatsPerBar,
      subdivision: s.subdivision,
      accent: s.accent,
      countIn: seg.countIn && !leavingCountIn,
    };
  }
}

function normalize(s: MetronomeSettings): MetronomeSettings {
  return { ...s, bpm: clampBpm(s.bpm), beatsPerBar: clampBeatsPerBar(s.beatsPerBar) };
}
