import type { Pad } from '../input';
import { computeLayout, laneCenterY, noteToX, scrollFitLayout, type HighwayLayout } from './layout';
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
  listenLabel: '#7fb4ff',
  playLabel: '#ff8a3d',
  banner: 'rgba(17, 20, 26, 0.85)',
  ruler: '#8b93a7',
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
  /** Shown large in the top-right corner while set, e.g. "Listen" or "Your turn". */
  banner: { text: string; tone: 'listen' | 'play' } | null = null;
  /**
   * While set, the picture stands still and shows exactly this time span across the note area
   * (a whole recording or import), and the time passed to draw() is ignored. Times are on the
   * model's own axis.
   */
  fit: { from: number; to: number; minPxPerMs?: number } | null = null;
  /** Bar numbers drawn in the header strip of a fitted picture (times on the model's axis). */
  ruler: readonly { time: number; label: string }[] | null = null;
  /**
   * A dense fitted picture (see `fit.minPxPerMs`) scrolls with this element: an overflow-x box
   * under the canvas holding one wide child. Its scrollLeft is read on every draw.
   */
  private scroller: { box: HTMLElement; spacer: HTMLElement } | null = null;
  private spacerWidth = -1;

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

  /** Use `box` (overflow-x: auto, holding `spacer`) as the scroll bar for dense fitted pictures. */
  attachScroller(box: HTMLElement, spacer: HTMLElement): void {
    this.scroller = { box, spacer };
    // A trackpad swipe or Shift+wheel over the canvas scrolls it too.
    this.canvas.addEventListener('wheel', (event) => {
      if (box.hidden) return;
      const dx = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
      if (dx === 0) return;
      event.preventDefault();
      box.scrollLeft += dx;
    }, { passive: false });
  }

  /** Show the scroll bar only while the picture needs it, with the right scroll width. */
  private updateScroller(contentWidth: number | null): void {
    const sc = this.scroller;
    if (!sc) return;
    const width = contentWidth === null ? 0 : Math.ceil(contentWidth);
    if (width === this.spacerWidth) return;
    this.spacerWidth = width;
    sc.box.hidden = width === 0;
    sc.spacer.style.width = `${width}px`;
    if (width === 0) sc.box.scrollLeft = 0;
  }

  dispose(): void {
    this.observer?.disconnect();
  }

  /** Draw the highway as of `now` (ms, performance.now() clock). */
  draw(time: number): void {
    if ((this.model?.hasOtherLane ?? false) !== this.showOther) this.applyHeight();
    else if (window.devicePixelRatio !== this.dpr) this.resize();
    const { ctx } = this;
    const fit = this.fit;
    const scrollFit = fit ? scrollFitLayout(this.layout, fit.from, fit.to, fit.minPxPerMs ?? 0, this.scroller?.box.scrollLeft ?? 0) : null;
    this.updateScroller(scrollFit?.scrolls ? scrollFit.contentWidth : null);
    const layout = scrollFit ? scrollFit.layout : this.layout;
    const now = fit ? fit.from : time;
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
    /** Header text already drawn (x ranges), so ruler numbers don't print over it. */
    const headerTaken: [number, number][] = [];
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
        // Right-aligned at the end, so it never sits on a turn label at the pass start.
        if (!Number.isNaN(region.end)) {
          ctx.font = SMALL_FONT;
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = COLORS.focusLabel;
          ctx.fillText(model.focusLabel, x1 - 4, lanesTop / 2 + 1);
          headerTaken.push([x1 - 4 - ctx.measureText(model.focusLabel).width - 4, x1]);
        }
      }

      // Turn labels ("Listen", "Your turn") at each pass's first downbeat.
      for (const mark of model.turnMarks) {
        const x = noteToX(mark.time, now, layout);
        if (x > w || x < labelWidth - 200) continue;
        ctx.font = FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = model.styleOf(mark.pass).outlined ? COLORS.listenLabel : COLORS.playLabel;
        ctx.fillText(mark.label, Math.max(x + 4, labelWidth + 4), lanesTop / 2 + 1);
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

      // Notes. A fitted picture can be dense (a whole song), so notes shrink to fit their spacing.
      const cap = fit ? Math.max(1.5, layout.pxPerMs * 45) : Infinity;
      const radius = Math.min(laneHeight * 0.26, cap);
      const accentRadius = Math.min(laneHeight * 0.36, cap * 1.3);
      for (const note of model.notes) {
        const x = noteToX(note.time, now, layout);
        if (x < labelWidth - accentRadius || x > w + accentRadius) continue;
        visibleNotes++;
        const y = laneCenterY(note.lane, layout);
        const r = note.accent ? accentRadius : radius;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        if (note.outlined) {
          // The app's turn: an outline, so it reads as "listen", not "play this".
          ctx.strokeStyle = note.state === 'pending' ? COLORS.listenLabel : STATE_COLORS[note.state];
          ctx.lineWidth = 2;
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = STATE_COLORS[note.state];
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

      // Bar numbers along the top of a fitted picture, skipping any too close to the last one.
      if (fit && this.ruler) {
        ctx.font = SMALL_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = COLORS.ruler;
        let lastX = -Infinity;
        for (const mark of this.ruler) {
          const x = noteToX(mark.time, now, layout);
          if (x < labelWidth - 1 || x > w - 4) continue;
          const width = ctx.measureText(mark.label).width;
          if (x < lastX + 6 || headerTaken.some(([a, b]) => x + 3 + width > a && x + 3 < b)) continue;
          ctx.fillText(mark.label, x + 3, lanesTop / 2 + 1);
          lastX = x + 3 + width;
        }
      }

      if (!fit) {
        ctx.fillStyle = COLORS.now;
        ctx.fillRect(layout.nowX - 1.5, 0, 3, h);
      }
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

    if (this.banner) {
      ctx.font = '700 15px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      const text = this.banner.text;
      const tw = ctx.measureText(text).width;
      const bx = w - tw - 22;
      ctx.fillStyle = COLORS.banner;
      ctx.fillRect(bx - 8, lanesTop + 4, tw + 24, 24);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.banner.tone === 'listen' ? COLORS.listenLabel : COLORS.playLabel;
      ctx.fillText(text, bx + 4, lanesTop + 16);
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
