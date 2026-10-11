import type { Pad } from '../input';
import { computeLayout, laneCenterY, noteToX, type HighwayLayout } from './layout';
import type { HighwayModel, NoteState } from './model';

/** Feedback colors, matching the grade colors used elsewhere on the page. */
export const STATE_COLORS: Readonly<Record<NoteState | 'extra', string>> = {
  pending: '#d6dbe8',
  perfect: '#3ddc84',
  good: '#9be37a',
  early: '#f5c542',
  late: '#f5c542',
  wrongPad: '#ff9f43',
  missed: '#ff5c5c',
  extra: '#7d8496',
};

const COLORS = {
  background: '#11141a',
  laneAlt: '#151922',
  laneEdge: '#232835',
  gutter: '#181b22',
  label: '#e6e8ee',
  muted: '#8b93a7',
  bar: '#596178',
  beat: '#2c3240',
  countIn: 'rgba(245, 197, 66, 0.35)',
  now: '#ff8a3d',
  tick: '#ffffff',
  accentRing: 'rgba(255, 255, 255, 0.85)',
  focus: 'rgba(127, 180, 255, 0.14)',
  focusEdge: 'rgba(127, 180, 255, 0.45)',
  focusLabel: '#7fb4ff',
  problemRing: '#ff5c8a',
} as const;

const LANE_HEIGHT_CSS = 34;
const HEADER_CSS = 14;
const FONT = '600 13px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const SMALL_FONT = '12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const TAU = Math.PI * 2;

/**
 * Draws a HighwayModel on a canvas. Positions are computed every frame from the time passed in
 * (performance.now() during a run) minus each note's time, never by moving things a fixed amount
 * per frame, so the picture stays locked to the audio even when frames drop.
 */
export class HighwayRenderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver | null;
  private model: HighwayModel | null = null;
  private labels: string[] = [];
  /** Whether the current layout includes the "other" lane. */
  private showOther = false;
  private layout: HighwayLayout;
  private dpr = 1;
  private cssWidth = 0;
  private cssHeight = 0;
  /** Shown when there are no notes on screen. */
  message = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly padLabel: (pad: Pad) => string,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.layout = computeLayout(1, 1, 1);
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this.observer?.observe(canvas);
    this.setModel(null);
  }

  setModel(model: HighwayModel | null): void {
    this.model = model;
    this.labels = model ? model.lanes.map((p) => this.padLabel(p)) : [];
    this.applyHeight();
  }

  /** Canvas height follows the lane count (plus "other" once needed); width follows the page. */
  private applyHeight(): void {
    this.showOther = this.model?.hasOtherLane ?? false;
    const lanes = Math.max(1, this.labels.length) + (this.showOther ? 1 : 0);
    this.canvas.style.height = `${HEADER_CSS + lanes * LANE_HEIGHT_CSS}px`;
    this.resize();
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  /** Draw the highway as of `now` (ms, performance.now() clock). */
  draw(now: number): void {
    if ((this.model?.hasOtherLane ?? false) !== this.showOther) this.applyHeight();
    else if (window.devicePixelRatio !== this.dpr) this.resize();
    const { ctx, layout } = this;
    const { width: w, height: h, labelWidth, laneHeight, lanesTop, otherTop, otherHeight } = layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);
    for (let lane = 0; lane < this.labels.length; lane++) {
      const top = lanesTop + lane * laneHeight;
      if (lane % 2 === 1) {
        ctx.fillStyle = COLORS.laneAlt;
        ctx.fillRect(0, top, w, laneHeight);
      }
      ctx.fillStyle = COLORS.laneEdge;
      ctx.fillRect(0, top, w, 1);
    }
    if (this.showOther) {
      ctx.fillStyle = COLORS.laneEdge;
      ctx.fillRect(0, otherTop, w, 1);
    }

    const model = this.model;
    let visibleNotes = 0;
    if (model) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(labelWidth, 0, w - labelWidth, h);
      ctx.clip();

      // Focus range: the part being graded for the headline number.
      for (const region of model.focusRegions) {
        if (Number.isNaN(region.start)) continue;
        const x0 = noteToX(region.start - region.padMs, now, layout);
        const x1 = Number.isNaN(region.end) ? w : noteToX(region.end + region.padMs, now, layout);
        if (x1 < labelWidth || x0 > w) continue;
        ctx.fillStyle = COLORS.focus;
        ctx.fillRect(x0, lanesTop, x1 - x0, h - lanesTop);
        ctx.fillStyle = COLORS.focusEdge;
        ctx.fillRect(x0, 0, 1, h);
        if (!Number.isNaN(region.end)) ctx.fillRect(x1 - 1, 0, 1, h);
        ctx.font = SMALL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.focusLabel;
        ctx.fillText('graded', x0 + 4, lanesTop / 2 + 1);
      }

      // Grid: bar lines bold, beat lines thin, count-in clicks as faint markers.
      for (const line of model.lines) {
        const x = noteToX(line.time, now, layout);
        if (x < labelWidth - 2 || x > w + 2) continue;
        if (line.kind === 'bar') {
          ctx.fillStyle = COLORS.bar;
          ctx.fillRect(x - 1, lanesTop, 2, otherTop - lanesTop);
        } else if (line.kind === 'beat') {
          ctx.fillStyle = COLORS.beat;
          ctx.fillRect(x - 0.5, lanesTop, 1, otherTop - lanesTop);
        } else {
          ctx.fillStyle = COLORS.countIn;
          ctx.fillRect(x - 0.5, lanesTop, 1, otherTop - lanesTop);
          ctx.beginPath();
          ctx.arc(x, lanesTop / 2, 3, 0, TAU);
          ctx.fill();
        }
      }

      // Notes.
      const radius = laneHeight * 0.26;
      const accentRadius = laneHeight * 0.36;
      for (const note of model.notes) {
        const x = noteToX(note.time, now, layout);
        if (x < labelWidth - accentRadius || x > w + accentRadius) continue;
        visibleNotes++;
        const y = laneCenterY(note.lane, layout);
        const r = note.accent ? accentRadius : radius;
        ctx.fillStyle = STATE_COLORS[note.state];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        if (note.accent) {
          ctx.strokeStyle = COLORS.accentRing;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        // Problem spot from earlier passes: ring it while it's still to be played.
        if (note.state === 'pending' && model.isHighlighted(note)) {
          ctx.strokeStyle = COLORS.problemRing;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(x, y, r + 5, 0, TAU);
          ctx.stroke();
        }
      }

      // Hits: a tick at the real hit time, so early or late shows as a gap from the note.
      const tickHalf = laneHeight * 0.42;
      for (const tick of model.ticks) {
        const x = noteToX(tick.hit.time, now, layout);
        if (x < labelWidth - 2 || x > w + 2) continue;
        const y = laneCenterY(tick.lane, layout);
        const half = tick.lane < 0 ? otherHeight * 0.42 : tickHalf;
        ctx.fillStyle = tick.state === 'extra' ? STATE_COLORS.extra : COLORS.tick;
        ctx.fillRect(x - 1, y - half, 2, half * 2);
      }

      ctx.fillStyle = COLORS.now;
      ctx.fillRect(layout.nowX - 1.5, 0, 3, h);
      ctx.restore();
    } else {
      ctx.fillStyle = COLORS.now;
      ctx.fillRect(layout.nowX - 1.5, 0, 3, h);
    }

    // Label gutter on top of everything that scrolled under it.
    ctx.fillStyle = COLORS.gutter;
    ctx.fillRect(0, 0, labelWidth, h);
    ctx.fillStyle = COLORS.laneEdge;
    ctx.fillRect(labelWidth - 1, 0, 1, h);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = FONT;
    ctx.fillStyle = COLORS.label;
    for (let lane = 0; lane < this.labels.length; lane++) {
      ctx.fillText(this.labels[lane]!, 10, laneCenterY(lane, layout), labelWidth - 16);
    }
    if (this.showOther) {
      ctx.font = SMALL_FONT;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText('other', 10, laneCenterY(-1, layout));
    }

    if (visibleNotes === 0 && this.message) {
      ctx.textAlign = 'center';
      ctx.font = FONT;
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(this.message, labelWidth + (w - labelWidth) / 2, lanesTop + (otherTop - lanesTop) / 2, w - labelWidth - 24);
    }
  }

  private resize(): void {
    // The content box (no border), which is what the backing store maps onto.
    this.dpr = window.devicePixelRatio || 1;
    this.cssWidth = Math.max(1, this.canvas.clientWidth);
    this.cssHeight = Math.max(1, this.canvas.clientHeight);
    const pixelWidth = Math.round(this.cssWidth * this.dpr);
    const pixelHeight = Math.round(this.cssHeight * this.dpr);
    if (this.canvas.width !== pixelWidth) this.canvas.width = pixelWidth;
    if (this.canvas.height !== pixelHeight) this.canvas.height = pixelHeight;
    this.layout = computeLayout(this.cssWidth, this.cssHeight, this.labels.length, { headerHeight: HEADER_CSS, otherLane: this.showOther });
  }
}
