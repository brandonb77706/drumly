import './style.css';
import {
  InputManager,
  KEYBOARD_CODE_TO_PAD,
  KeyboardSource,
  MidiSource,
  PADS,
  TestSource,
  keyCodeLabel,
  type Hit,
  type Pad,
  type ScriptedHit,
} from './input';
import { rockBeat } from './patterns';
import { LiveGrader, DEFAULT_GRADING_CONFIG, summarize, type ExpectedNote, type GradeSummary, type HitVerdict } from './grading';
import { GRADE_BARS, GRADE_BPM, GRADE_SCENARIOS, checkSummary, rockBeatNotes, type GradeScenario } from './gradeScenarios';
import { Metronome, MAX_BPM, MIN_BPM, SUBDIVISIONS, isClickMode, type ClickMode, type MetronomeClick, type Subdivision } from './metronome';
import {
  ALL_LESSONS,
  SPEED_OPTIONS,
  formatLessonText,
  lessonBpmAt,
  lessonNoteSource,
  lessonToExpectedNotes,
  noteId,
  notePass,
  resultForPass,
  type Lesson,
  type LessonCategory,
} from './lessons';
import { HighwayModel, HighwayRenderer } from './highway';
import { PAD_LABELS, buildSummary, fmtPct, node } from './ui/summary';

const LOG_SIZE = 30;


function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

function setStatus(which: 'kb' | 'midi', text: string, level: 'ok' | 'warn' | 'bad'): void {
  el(`${which}-status`).textContent = text;
  el(`${which}-dot`).className = `dot ${level}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- Pad tiles -------------------------------------------------------------

const keysByPad = new Map<Pad, string[]>();
for (const [code, pad] of KEYBOARD_CODE_TO_PAD) {
  keysByPad.set(pad, [...(keysByPad.get(pad) ?? []), keyCodeLabel(code)]);
}

const flashByPad = new Map<Pad, HTMLElement>();
const tileByPad = new Map<Pad, HTMLElement>();
const padsEl = el('pads');
for (const pad of PADS) {
  const tile = document.createElement('div');
  tile.className = 'pad';
  const flash = document.createElement('div');
  flash.className = 'flash';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = PAD_LABELS[pad];
  const key = document.createElement('div');
  key.className = 'key';
  key.textContent = keysByPad.get(pad)?.join(' / ') ?? 'MIDI only';
  tile.append(flash, name, key);
  padsEl.append(tile);
  flashByPad.set(pad, flash);
  tileByPad.set(pad, tile);
}

function flashPad(hit: Hit): void {
  flashTile(flashByPad.get(hit.pad), hit.velocity);
}

/** Flash a pad tile's overlay, brighter and longer for harder hits. */
function flashTile(flash: HTMLElement | undefined, velocity: number): void {
  if (!flash) return;
  const peak = 0.15 + 0.85 * (velocity / 127);
  flash.getAnimations().forEach((a) => a.cancel());
  flash.animate([{ opacity: peak }, { opacity: 0 }], { duration: 120 + 230 * (velocity / 127), easing: 'ease-out' });
}

const GRADE_COLORS = { good: '#3ddc84', ok: '#f5c542', bad: '#ff5c5c' } as const;

/** Outline a pad tile in a grade color (green / yellow / red). */
function flashGrade(pad: Pad, level: keyof typeof GRADE_COLORS): void {
  const color = GRADE_COLORS[level];
  for (const target of [tileByPad.get(pad), lessonChipByPad.get(pad)]) {
    target?.animate(
      [{ boxShadow: `inset 0 0 0 3px ${color}, 0 0 16px ${color}` }, { boxShadow: 'inset 0 0 0 3px transparent, 0 0 0 transparent' }],
      { duration: 450, easing: 'ease-out' },
    );
  }
}

/** Pad chips in the lesson view (filled in when a lesson is selected), and their flash overlays. */
const lessonChipByPad = new Map<Pad, HTMLElement>();
const lessonChipFlashByPad = new Map<Pad, HTMLElement>();

// ---- Keyboard map ----------------------------------------------------------

const keymapEl = el('keymap');
for (const [code, pad] of KEYBOARD_CODE_TO_PAD) {
  const li = document.createElement('li');
  const kbd = document.createElement('kbd');
  kbd.textContent = keyCodeLabel(code);
  const label = document.createElement('span');
  label.textContent = PAD_LABELS[pad];
  li.append(kbd, label);
  keymapEl.append(li);
}

// ---- Metronome -------------------------------------------------------------

const metronome = new Metronome({
  bpm: 100,
  beatsPerBar: 4,
  subdivision: 'eighth',
  accent: true,
  countIn: false,
  volume: 0.8,
});

/** Signed ms from the nearest click (negative = early). Rough debug view, not the grading engine. */
function offsetFromNearestClick(hit: Hit): number | null {
  if (!metronome.isRunning) return null;
  // ±2.5 s covers a full beat even at 30 BPM.
  let best: number | null = null;
  for (const click of metronome.getGrid(hit.time - 2500, hit.time + 2500)) {
    const offset = hit.time - click.time;
    if (best === null || Math.abs(offset) < Math.abs(best)) best = offset;
  }
  return best;
}

function offsetClass(offset: number): string {
  const abs = Math.abs(offset);
  return abs <= 10 ? 'num off-good' : abs <= 30 ? 'num off-ok' : 'num off-bad';
}

// ---- Hit log ---------------------------------------------------------------

const logEl = el('log');
const logRows: HTMLTableRowElement[] = [];
let previousHit: Hit | null = null;
/** Grade cell of each logged hit, so live verdicts (and revisions) can fill it in. */
const gradeCells = new WeakMap<Hit, HTMLTableCellElement>();

function pushLogRow(row: HTMLTableRowElement): void {
  logEl.prepend(row);
  logRows.unshift(row);
  while (logRows.length > LOG_SIZE) logRows.pop()?.remove();
}

function verdictText(v: HitVerdict): string {
  if (v.status === 'extra') return 'extra';
  const offset = `${v.offsetMs > 0 ? '+' : ''}${v.offsetMs.toFixed(1)}`;
  const what = v.status === 'hit' ? 'hit' : `wrong pad (wanted ${PAD_LABELS[v.note.pad]})`;
  return `${what} · ${v.timing} ${offset}`;
}

function verdictClass(v: HitVerdict): string {
  if (v.status === 'extra') return 'g-extra';
  if (v.status === 'wrongPad') return 'g-wrongPad';
  return `g-${v.timing}`;
}

function verdictLevel(v: HitVerdict): keyof typeof GRADE_COLORS {
  if (v.status !== 'hit') return 'bad';
  return v.timing === 'perfect' || v.timing === 'good' ? 'good' : 'ok';
}

function setGradeCell(hit: Hit, verdict: HitVerdict): void {
  const cell = gradeCells.get(hit);
  if (!cell) return;
  cell.textContent = verdictText(verdict);
  cell.className = verdictClass(verdict);
}

function logMissed(note: ExpectedNote): void {
  const row = document.createElement('tr');
  row.className = 'missed-row';
  for (const [text, cls] of [[PAD_LABELS[note.pad], ''], ['—', 'num'], ['—', 'num'], ['—', 'num'], ['missed', 'g-missed'], ['—', '']] as const) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    row.append(td);
  }
  pushLogRow(row);
}

function logHit(hit: Hit): void {
  const gap = previousHit ? (hit.time - previousHit.time).toFixed(1) : '—';
  previousHit = hit;
  const offset = offsetFromNearestClick(hit);
  const offsetText = offset === null ? '—' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)}`;

  const row = document.createElement('tr');
  const cells: [string, string][] = [
    [PAD_LABELS[hit.pad], ''],
    [String(hit.velocity), 'num'],
    [gap, 'num'],
    [offsetText, offset === null ? 'num' : offsetClass(offset)],
    ['', ''],
    [hit.source, `src-${hit.source}`],
  ];
  cells.forEach(([text, cls], i) => {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    if (i === 4) gradeCells.set(hit, td);
    row.append(td);
  });
  pushLogRow(row);
}

// ---- Input wiring ----------------------------------------------------------

const manager = new InputManager();
manager.add(new KeyboardSource());
manager.add(
  new MidiSource({
    onDevicesChange: (names) => {
      if (names.length > 0) setStatus('midi', names.join(', '), 'ok');
      else setStatus('midi', 'no device connected', 'warn');
    },
  }),
);

manager.onHit((hit) => {
  flashPad(hit);
  logHit(hit);
});

function updateKeyboardFocus(): void {
  if (document.hasFocus()) setStatus('kb', 'listening', 'ok');
  else setStatus('kb', 'click the page to give it focus', 'warn');
}

const result = await manager.start();
for (const failure of result.failed) {
  const which = failure.name === 'keyboard' ? 'kb' : failure.name === 'midi' ? 'midi' : null;
  if (which) setStatus(which, `unavailable: ${errorMessage(failure.error)}`, 'bad');
  console.warn(`Input source "${failure.name}" failed to start`, failure.error);
}
if (result.started.includes('keyboard')) {
  updateKeyboardFocus();
  window.addEventListener('focus', updateKeyboardFocus);
  window.addEventListener('blur', updateKeyboardFocus);
}

// ---- Metronome controls ------------------------------------------------------

const toggleButton = el<HTMLButtonElement>('met-toggle');
const bpmRange = el<HTMLInputElement>('bpm-range');
const bpmNumber = el<HTMLInputElement>('bpm-number');
const beatsPerBarInput = el<HTMLInputElement>('beats-per-bar');
const subdivisionSelect = el<HTMLSelectElement>('subdivision');
const accentInput = el<HTMLInputElement>('accent');
const countInInput = el<HTMLInputElement>('count-in');
const volumeInput = el<HTMLInputElement>('volume');
const latencyInput = el<HTMLInputElement>('latency');
const clockInfoEl = el('clock-info');

function updateToggle(): void {
  toggleButton.textContent = metronome.isRunning ? 'Stop' : 'Start';
  toggleButton.classList.toggle('playing', metronome.isRunning);
}

/** Starts audio. Must be called synchronously from a click handler (autoplay rules). */
async function startMetronome() {
  const info = await metronome.start();
  updateToggle();
  return info;
}

function stopMetronome(): void {
  metronome.stop();
  stopTestPattern?.();
  cancelActiveGrade?.();
  cancelLesson?.();
  resetBeatIndicator();
  updateToggle();
}

toggleButton.addEventListener('click', () => {
  toggleButton.blur(); // keep Space for the kick
  if (metronome.isRunning) stopMetronome();
  else void startMetronome();
});

function setBpm(value: number): void {
  if (!Number.isFinite(value)) return;
  // Not rounded: a 75% practice speed can be e.g. 63.75 BPM.
  const bpm = Math.min(MAX_BPM, Math.max(MIN_BPM, value));
  metronome.setBpm(bpm);
  bpmRange.value = String(bpm);
  if (document.activeElement !== bpmNumber || Number(bpmNumber.value) !== bpm) bpmNumber.value = String(bpm);
}

bpmRange.addEventListener('input', () => setBpm(Number(bpmRange.value)));
bpmNumber.addEventListener('input', () => {
  const v = Number(bpmNumber.value);
  if (bpmNumber.value !== '' && v >= MIN_BPM && v <= MAX_BPM) setBpm(v);
});
bpmNumber.addEventListener('change', () => setBpm(Number(bpmNumber.value) || metronome.getSettings().bpm));

beatsPerBarInput.addEventListener('change', () => {
  const v = Math.round(Number(beatsPerBarInput.value));
  if (Number.isFinite(v) && v >= 1) metronome.setBeatsPerBar(v);
  beatsPerBarInput.value = String(metronome.getSettings().beatsPerBar);
});

subdivisionSelect.addEventListener('change', () => {
  const value = subdivisionSelect.value;
  if ((SUBDIVISIONS as readonly string[]).includes(value)) metronome.setSubdivision(value as Subdivision);
});
accentInput.addEventListener('change', () => metronome.setAccent(accentInput.checked));
countInInput.addEventListener('change', () => metronome.setCountIn(countInInput.checked));
volumeInput.addEventListener('input', () => metronome.setVolume(Number(volumeInput.value) / 100));
latencyInput.addEventListener('change', () => {
  const v = Number(latencyInput.value);
  if (latencyInput.value !== '' && Number.isFinite(v)) metronome.setLatencyOffset(v);
  latencyInput.value = String(metronome.getSettings().latencyOffsetMs);
});

// Focused form controls swallow drum keys (KeyboardSource ignores them on purpose),
// so hand focus back to the page once a value is committed.
for (const control of [bpmRange, bpmNumber, beatsPerBarInput, subdivisionSelect, accentInput, countInInput, volumeInput, latencyInput]) {
  control.addEventListener('change', () => control.blur());
}

// ---- Beat indicator (requestAnimationFrame, never setTimeout) ----------------

const beatsEl = el('beats');
const barLabelEl = el('bar-label');
/** Clicks scheduled but not yet heard, in time order. */
let upcomingClicks: MetronomeClick[] = [];
/** Most recent click that has been heard. */
let currentClick: MetronomeClick | null = null;
/** Most recent on-the-beat click that has been heard, for the glow. */
let currentBeat: MetronomeClick | null = null;

metronome.onClick((click) => upcomingClicks.push(click));

function renderDots(count: number): HTMLElement[] {
  if (beatsEl.children.length !== count) {
    beatsEl.replaceChildren(
      ...Array.from({ length: count }, (_, i) => {
        const dot = document.createElement('span');
        dot.className = i === 0 ? 'beat-dot first' : 'beat-dot';
        return dot;
      }),
    );
  }
  return [...beatsEl.children] as HTMLElement[];
}

function resetBeatIndicator(): void {
  upcomingClicks = [];
  currentClick = null;
  currentBeat = null;
  beatsEl.classList.remove('countin');
  for (const dot of renderDots(metronome.getSettings().beatsPerBar)) dot.classList.remove('on');
  barLabelEl.textContent = '';
}

let lastClockInfoUpdate = 0;

function frame(now: number): void {
  // rAF's timestamp is on the performance.now() clock, same as click.time.
  while (upcomingClicks.length > 0 && upcomingClicks[0]!.time <= now) {
    currentClick = upcomingClicks.shift()!;
    if (currentClick.subdivision === 0) currentBeat = currentClick;
  }

  const activeLesson = lessonRun ?? previewRun;
  if (currentClick && currentBeat) {
    const dots = renderDots(currentClick.beatsPerBar);
    const glow = Math.max(0, 1 - (now - currentBeat.time) / 180);
    dots.forEach((dot, i) => {
      const on = i === currentBeat!.beat;
      dot.classList.toggle('on', on);
      dot.style.setProperty('--glow', on ? glow.toFixed(3) : '0');
    });
    beatsEl.classList.toggle('countin', currentBeat.isCountIn);
    barLabelEl.textContent = currentBeat.isCountIn
      ? 'Count-in'
      : activeLesson
        ? `${activeLesson.loop ? `Pass ${Math.floor(currentBeat.bar / activeLesson.lesson.bars) + 1} · ` : ''}Bar ${(currentBeat.bar % activeLesson.lesson.bars) + 1} of ${activeLesson.lesson.bars}`
        : `Bar ${currentBeat.bar + 1}`;
  } else if (beatsEl.children.length === 0) {
    renderDots(metronome.getSettings().beatsPerBar);
  }

  lessonFrame(now);
  highwayFrame(now);

  if (now - lastClockInfoUpdate > 500) {
    lastClockInfoUpdate = now;
    if (metronome.isRunning) {
      const info = metronome.getClockInfo();
      const source =
        info.source === 'outputTimestamp'
          ? 'clock synced via getOutputTimestamp (output latency included)'
          : `clock estimated from currentTime + ${info.latencyMs.toFixed(1)} ms output latency`;
      clockInfoEl.textContent = `Audio ${source}. Offset: ${metronome.getSettings().latencyOffsetMs} ms.` +
        (info.droppedClicks > 0 ? ` Dropped ${info.droppedClicks} late clicks.` : '');
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---- Test pattern ----------------------------------------------------------

const playButton = el<HTMLButtonElement>('play');
let stopTestPattern: (() => void) | null = null;

/** performance.now() time of the next bar-1 downbeat at least `minLeadMs` away, or null. */
function nextDownbeat(minLeadMs: number): number | null {
  const now = performance.now();
  const { bpm, beatsPerBar } = metronome.getSettings();
  const barMs = (60_000 / bpm) * beatsPerBar;
  const downbeat = metronome
    .getGrid(now + minLeadMs, now + minLeadMs + 2 * barMs + 100)
    .find((c) => !c.isCountIn && c.beat === 0 && c.subdivision === 0);
  return downbeat?.time ?? null;
}

/** Resolve once the metronome's clock is synced to the audio output (or after ~600 ms). Uses rAF, not timers. */
function waitForClockSync(): Promise<void> {
  const giveUpAt = performance.now() + 600;
  return new Promise((resolve) => {
    const check = (now: number) => {
      if (metronome.getClockInfo().source === 'outputTimestamp' || now >= giveUpAt || !metronome.isRunning) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/**
 * Play a script whose offsets are relative to `anchor` (performance.now() ms). TestSource stamps
 * each hit at exactly anchor + at, and its timer fires at about the right moment.
 */
function playScriptAt(script: readonly ScriptedHit[], anchor: number, onDone?: () => void): () => void {
  stopTestPattern?.();
  const startedAt = performance.now();
  const lead = anchor - startedAt;
  const shifted = script.map((h) => ({ ...h, at: h.at + lead }));

  let remove: (() => void) | null = null;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    remove?.();
    if (stopTestPattern === finish) stopTestPattern = null;
    onDone?.();
  };
  stopTestPattern = finish;
  remove = manager.add(new TestSource(shifted, { now: () => startedAt, onDone: finish }));
  if (finished) remove();
  return finish;
}

playButton.addEventListener('click', () => {
  // Don't keep focus on the button, or Space (kick) would also "click" it.
  playButton.blur();
  playButton.disabled = true;
  // Start audio synchronously inside the click handler (autoplay rules).
  const wasRunning = metronome.isRunning;
  const starting = wasRunning ? null : startMetronome();

  void (async () => {
    if (starting) {
      await starting;
      // The first moments after audio starts use an estimated clock; anchoring the pattern
      // to that estimate would put every hit a few ms off once the real sync kicks in.
      await waitForClockSync();
    }
    const anchor = nextDownbeat(150);
    if (anchor === null || !metronome.isRunning) {
      playButton.disabled = false;
      return;
    }
    playScriptAt(rockBeat(metronome.getSettings().bpm, 2), anchor, () => {
      playButton.disabled = false;
    });
  })();
});

// ---- Grade test ------------------------------------------------------------

const gradeButtonsEl = el('grade-buttons');
const gradeStatusEl = el('grade-status');
const gradeSummaryEl = el('grade-summary');
let cancelActiveGrade: (() => void) | null = null;

const gradeButtons: HTMLButtonElement[] = [];
function addGradeButton(label: string, scenario: GradeScenario | null): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    button.blur();
    runGrade(scenario);
  });
  gradeButtons.push(button);
  gradeButtonsEl.append(button);
}
addGradeButton('Grade me (keyboard)', null);
for (const scenario of GRADE_SCENARIOS) addGradeButton(`Replay: ${scenario.label}`, scenario);

function setGradeBusy(busy: boolean): void {
  for (const b of gradeButtons) b.disabled = busy;
  playButton.disabled = busy;
  gradeStatusEl.classList.toggle('running', busy);
}

/** Put the metronome into the exercise's settings and mirror them in the controls. */
function applyGradeSettings(): void {
  applyMetronomeSettings({ bpm: GRADE_BPM, beatsPerBar: 4, subdivision: 'eighth', countIn: true });
}

/** Set the metronome and mirror the values in the debug controls. */
function applyMetronomeSettings(settings: { bpm: number; beatsPerBar: number; subdivision: Subdivision; countIn: boolean }): void {
  setBpm(settings.bpm);
  metronome.setBeatsPerBar(settings.beatsPerBar);
  beatsPerBarInput.value = String(settings.beatsPerBar);
  metronome.setSubdivision(settings.subdivision);
  subdivisionSelect.value = settings.subdivision;
  metronome.setCountIn(settings.countIn);
  countInInput.checked = settings.countIn;
}

/** performance.now() time of bar 0, beat 1 of the current run, if it's still ahead. */
function bar0Downbeat(): number | null {
  const now = performance.now();
  const click = metronome.getGrid(now, now + 10_000).find((c) => c.bar === 0 && c.beat === 0 && c.subdivision === 0);
  return click && click.time > now + 50 ? click.time : null;
}

/** Must be called synchronously from a click handler: it may start audio. */
function runGrade(scenario: GradeScenario | null): void {
  cancelActiveGrade?.();
  if (metronome.isRunning) stopMetronome();
  applyGradeSettings();
  setGradeBusy(true);
  gradeSummaryEl.replaceChildren();
  gradeStatusEl.textContent = 'Starting metronome…';
  const starting = startMetronome();

  let cancelled = false;
  cancelActiveGrade = () => {
    cancelled = true;
  };

  void (async () => {
    await starting;
    await waitForClockSync();
    if (cancelled || !metronome.isRunning) return finishCancelled();

    const downbeat = bar0Downbeat() ?? nextDownbeat(150);
    if (downbeat === null) return finishCancelled();

    const notes = rockBeatNotes(downbeat);
    const grader = new LiveGrader(manager, notes, { ignoreHitsBefore: downbeat - DEFAULT_GRADING_CONFIG.windowMs });
    let stopScript: (() => void) | null = null;

    const finish = (completed: boolean) => {
      cancelActiveGrade = null;
      stopScript?.();
      const final = grader.stop();
      if (metronome.isRunning) stopMetronome();
      setGradeBusy(false);
      gradeStatusEl.textContent = completed ? 'Done.' : 'Stopped early: partial results.';
      renderSummary(final.summary, scenario);
    };
    cancelActiveGrade = () => finish(false);

    grader.onEvent((event) => {
      switch (event.type) {
        case 'hit':
          setGradeCell(event.hit, event.verdict);
          flashGrade(event.hit.pad, verdictLevel(event.verdict));
          break;
        case 'revised':
          setGradeCell(event.hit, event.verdict);
          break;
        case 'missed':
          logMissed(event.note);
          flashGrade(event.note.pad, 'bad');
          break;
        case 'complete':
          finish(true);
          break;
      }
    });
    grader.start();

    gradeStatusEl.textContent = scenario
      ? `Replaying "${scenario.label}"… (${GRADE_BARS} bars after the count-in)`
      : `Count-in, then play ${GRADE_BARS} bars: hi-hat K on 8ths, kick Space/F on 1 and 3, snare J on 2 and 4.`;
    if (scenario) stopScript = playScriptAt(scenario.script, downbeat);
  })();

  function finishCancelled(): void {
    cancelActiveGrade = null;
    setGradeBusy(false);
    gradeStatusEl.textContent = 'Grade cancelled.';
  }
}

// ---- Summary rendering -----------------------------------------------------

function renderSummary(s: GradeSummary, scenario: GradeScenario | null): void {
  const parts: HTMLElement[] = buildSummary(s);
  if (scenario) {
    const problems = checkSummary({
      accuracy: s.accuracy ?? NaN,
      hit: s.hit,
      wrongPad: s.wrongPad,
      missed: s.missed,
      extra: s.extra,
      meanOffsetMs: s.meanOffsetMs ?? NaN,
      stdDevOffsetMs: s.stdDevOffsetMs ?? NaN,
    }, scenario.expected);
    const check = node('div', `scenario-check ${problems.length === 0 ? 'pass' : 'fail'}`,
      problems.length === 0
        ? `✓ "${scenario.label}" matches its expected summary.`
        : `✗ "${scenario.label}" does not match its expected summary:`);
    if (problems.length > 0) check.append(node('ul', '', undefined, problems.map((p) => node('li', '', p))));
    parts.unshift(check);
  }
  gradeSummaryEl.replaceChildren(node('div', 'summary', undefined, parts));
}

// ---- Lessons (main view) -------------------------------------------------------

const lessonSelect = el<HTMLSelectElement>('lesson-select');
const lessonSpeedSelect = el<HTMLSelectElement>('lesson-speed');
const lessonBpmInput = el<HTMLInputElement>('lesson-bpm');
const clickModeSelect = el<HTMLSelectElement>('click-mode');
const lessonLoopInput = el<HTMLInputElement>('lesson-loop');
const lessonPreviewButton = el<HTMLButtonElement>('lesson-preview');
const lessonStartButton = el<HTMLButtonElement>('lesson-start');
const lessonDescriptionEl = el('lesson-description');
const lessonPatternEl = el('lesson-pattern');
const lessonKeysEl = el('lesson-keys');
const lessonPadsEl = el('lesson-pads');
const lessonStatusEl = el('lesson-status');
const lessonFeedbackEl = el('lesson-feedback');
const lessonHistoryEl = el('lesson-history');
const lessonSummaryEl = el('lesson-summary');

/** Extra wait after a pass's last note before its summary is final enough to show (matches LiveGrader's miss grace). */
const PASS_REPORT_GRACE_MS = 50;
/** How long a preview keeps going after its last note. */
const PREVIEW_TAIL_MS = 400;

/** Best accuracy per lesson id, for this page session only. */
const bestAccuracy = new Map<string, number>();

interface PassWindow {
  /** Tempo the window was computed at; recomputed if the BPM changes. */
  bpm: number;
  /** performance.now() ms of the pass's first downbeat. */
  start: number;
  /** First downbeat of the next pass. */
  end: number;
  /** Time of the pass's last expected note. */
  lastNote: number;
}

interface LessonRun {
  lesson: Lesson;
  loop: boolean;
  grader: LiveGrader;
  /** Next pass whose summary hasn't been shown yet. */
  nextPass: number;
  passWindows: Map<number, PassWindow>;
  accuracies: number[];
}

/** Preview: the lesson plays once with the metronome, ungraded, flashing the pads on each note. */
interface PreviewRun {
  lesson: Lesson;
  loop: false;
  lastNoteId: string;
  /** Set once the last note has reached the now line. */
  endAt: number | null;
}

let lessonRun: LessonRun | null = null;
let previewRun: PreviewRun | null = null;
let cancelLesson: (() => void) | null = null;
let lessonStarting = false;
/** Bumped on every start/stop so a stale async startup can tell it was superseded. */
let lessonGeneration = 0;

// ---- Highway -------------------------------------------------------------------

const highway = new HighwayRenderer(el<HTMLCanvasElement>('highway'), (pad) => PAD_LABELS[pad]);
const IDLE_MESSAGE = 'Press Preview to see and hear it once, or Start to play.';

/** What the highway shows. `frozenAt` holds the picture still after a run ends. */
let highwayView: { model: HighwayModel; frozenAt: number | null } | null = null;

function showHighway(model: HighwayModel, frozenAt: number | null): void {
  highwayView = { model, frozenAt };
  highway.setModel(model);
}

function freezeHighway(): void {
  if (highwayView && highwayView.frozenAt === null) highwayView.frozenAt = performance.now();
}

const getGrid = (from: number, to: number) => metronome.getGrid(from, to);

function flashPreviewNote(pad: Pad, accent: boolean): void {
  const velocity = accent ? 127 : 95;
  flashTile(flashByPad.get(pad), velocity);
  flashTile(lessonChipFlashByPad.get(pad), velocity);
}

/** Called every animation frame. Drawing uses `now` directly; the grid is re-read only every ~200 ms. */
function highwayFrame(now: number): void {
  const view = highwayView;
  if (view && view.frozenAt === null && metronome.isRunning) {
    view.model.refresh(now, getGrid);
    const preview = previewRun;
    if (preview) {
      view.model.takePassed(now, (note) => {
        flashPreviewNote(note.pad, note.accent);
        if (note.id === preview.lastNoteId) preview.endAt = note.time + PREVIEW_TAIL_MS;
      });
      if (preview.endAt !== null && now >= preview.endAt) stopLesson('Preview done. Press Start to play it.');
    }
  }
  highway.draw(highwayView?.frozenAt ?? now);
}

// ---- Lesson controls -----------------------------------------------------------

const CATEGORY_LABELS: Record<LessonCategory, string> = { beat: 'Beats', fill: 'Fills' };

function selectedLesson(): Lesson {
  return ALL_LESSONS.find((l) => l.id === lessonSelect.value) ?? ALL_LESSONS[0]!;
}

function renderLessonPicker(): void {
  const current = lessonSelect.value || ALL_LESSONS[0]!.id;
  const groups = (Object.keys(CATEGORY_LABELS) as LessonCategory[]).map((category) => {
    const group = node('optgroup', '');
    group.label = CATEGORY_LABELS[category];
    group.append(
      ...ALL_LESSONS.filter((l) => l.category === category).map((l) => {
        const best = bestAccuracy.get(l.id);
        const option = node('option', '', best === undefined ? l.title : `${l.title} (best ${fmtPct(best)})`);
        option.value = l.id;
        return option;
      }),
    );
    return group;
  });
  lessonSelect.replaceChildren(...groups.filter((g) => g.children.length > 0));
  lessonSelect.value = current;
}

// Speed: a fraction of the lesson's default BPM.
lessonSpeedSelect.replaceChildren(
  ...SPEED_OPTIONS.map((speed) => {
    const option = node('option', '', `${speed * 100}%`);
    option.value = String(speed);
    return option;
  }),
);
lessonSpeedSelect.value = '1';

function selectedSpeed(): number {
  const v = Number(lessonSpeedSelect.value);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function formatBpm(bpm: number): string {
  return String(Number(bpm.toFixed(2)));
}

// Click mode: remembered for this page session only.
const CLICK_MODE_KEY = 'drumly.clickMode';
function loadClickMode(): ClickMode {
  try {
    const saved = sessionStorage.getItem(CLICK_MODE_KEY);
    if (isClickMode(saved)) return saved;
  } catch {
    // storage unavailable: use the default
  }
  return 'on';
}
function setClickMode(mode: ClickMode): void {
  metronome.setClickMode(mode);
  clickModeSelect.value = mode;
  try {
    sessionStorage.setItem(CLICK_MODE_KEY, mode);
  } catch {
    // storage unavailable: the choice still applies until reload
  }
}
setClickMode(loadClickMode());
clickModeSelect.addEventListener('change', () => {
  clickModeSelect.blur();
  if (isClickMode(clickModeSelect.value)) setClickMode(clickModeSelect.value);
});

function showLesson(lesson: Lesson): void {
  lessonBpmInput.value = formatBpm(lessonBpmAt(lesson, selectedSpeed()));
  lessonDescriptionEl.textContent = `${lesson.description} ${lesson.bars} bars, ${lesson.beatsPerBar}/4, written in ${lesson.subdivision} notes.`;
  lessonPatternEl.textContent = formatLessonText(lesson);

  const pads: Pad[] = [];
  for (const n of lesson.notes) if (!pads.includes(n.pad)) pads.push(n.pad);
  lessonKeysEl.textContent = 'Keys: ' + pads.map((p) => `${PAD_LABELS[p]} ${keysByPad.get(p)?.join(' or ') ?? '(MIDI only)'}`).join(' · ') +
    (lesson.equivalentPads?.length ? ' · any hi-hat sound counts' : '');

  lessonChipByPad.clear();
  lessonChipFlashByPad.clear();
  lessonPadsEl.replaceChildren(
    ...pads.map((p) => {
      const flash = node('div', 'flash');
      const chip = node('span', 'lesson-pad', undefined, [flash, node('span', 'name', PAD_LABELS[p])]);
      lessonChipByPad.set(p, chip);
      lessonChipFlashByPad.set(p, flash);
      return chip;
    }),
  );
  lessonHistoryEl.replaceChildren();
  lessonSummaryEl.replaceChildren();
  lessonFeedbackEl.textContent = '';
  lessonFeedbackEl.className = 'lesson-feedback';
  showHighway(new HighwayModel(lesson), null);
}

function updateLessonControls(): void {
  const active = lessonRun !== null || previewRun !== null || lessonStarting;
  lessonStartButton.textContent = active ? 'Stop' : 'Start';
  lessonStartButton.classList.toggle('playing', active);
  lessonPreviewButton.disabled = active;
  lessonSelect.disabled = active;
  lessonLoopInput.disabled = active;
  highway.message = active ? '' : IDLE_MESSAGE;
}

function lessonBpm(lesson: Lesson): number {
  const v = Number(lessonBpmInput.value);
  return lessonBpmInput.value !== '' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM ? v : lessonBpmAt(lesson, selectedSpeed());
}

/** Apply the BPM input; while a lesson plays, the tempo changes from the next beat and notes follow the clicks. */
function commitLessonBpm(): void {
  const bpm = lessonBpm(selectedLesson());
  lessonBpmInput.value = formatBpm(bpm);
  if (lessonRun || previewRun) setBpm(bpm);
}

lessonSelect.addEventListener('change', () => {
  lessonSelect.blur();
  showLesson(selectedLesson());
});
lessonSpeedSelect.addEventListener('change', () => {
  lessonSpeedSelect.blur();
  lessonBpmInput.value = formatBpm(lessonBpmAt(selectedLesson(), selectedSpeed()));
  commitLessonBpm();
});
lessonBpmInput.addEventListener('change', () => {
  lessonBpmInput.blur();
  commitLessonBpm();
});
lessonLoopInput.addEventListener('change', () => lessonLoopInput.blur());

lessonStartButton.addEventListener('click', () => {
  lessonStartButton.blur();
  if (lessonRun || previewRun || lessonStarting) stopLesson('Stopped.');
  else startLesson(selectedLesson(), lessonLoopInput.checked, 'play');
});
lessonPreviewButton.addEventListener('click', () => {
  lessonPreviewButton.blur();
  if (!lessonRun && !previewRun && !lessonStarting) startLesson(selectedLesson(), false, 'preview');
});

/** performance.now() time of the downbeat starting metronome bar `bar`, if it is in the grid. */
function barStartTime(bar: number, around: number, spanMs: number): number | null {
  const click = metronome.getGrid(around - spanMs, around + spanMs).find((c) => c.bar === bar && c.beat === 0 && c.subdivision === 0);
  return click?.time ?? null;
}

/** Must be called synchronously from a click handler: it starts audio. */
function startLesson(lesson: Lesson, loop: boolean, mode: 'play' | 'preview'): void {
  if (metronome.isRunning) stopMetronome(); // also stops grade tests and test patterns
  applyMetronomeSettings({ bpm: lessonBpm(lesson), beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  lessonStarting = true;
  updateLessonControls();
  lessonHistoryEl.replaceChildren();
  lessonSummaryEl.replaceChildren();
  lessonFeedbackEl.textContent = '';
  lessonStatusEl.textContent = 'Starting…';
  lessonStatusEl.classList.add('running');
  // The highway starts with the metronome, so the count-in is visible.
  const model = new HighwayModel(lesson, { passes: loop ? Infinity : 1 });
  showHighway(model, null);
  const starting = startMetronome();
  const generation = ++lessonGeneration;
  cancelLesson = () => stopLesson('Stopped.');

  if (mode === 'preview') {
    void (async () => {
      await starting;
      if (generation !== lessonGeneration) return;
      if (!metronome.isRunning) return stopLesson('Could not start. Press Preview again.');
      lessonStarting = false;
      previewRun = { lesson, loop: false, lastNoteId: noteId(lesson.id, 0, lesson.notes.length - 1), endAt: null };
      lessonStatusEl.textContent = 'Preview: watch and listen. Not graded.';
      updateLessonControls();
    })();
    return;
  }

  void (async () => {
    await starting;
    await waitForClockSync();
    if (generation !== lessonGeneration) return; // stopped (or restarted) meanwhile
    const downbeat = bar0Downbeat();
    if (!metronome.isRunning || downbeat === null) {
      stopLesson('Could not start in time. Press Start again.');
      return;
    }

    const grader = new LiveGrader(
      manager,
      // Notes come straight from the metronome's click times, fetched as the grader needs them.
      lessonNoteSource(lesson, getGrid, { passes: loop ? Infinity : 1 }),
      {
        ignoreHitsBefore: downbeat - DEFAULT_GRADING_CONFIG.windowMs,
        ...(lesson.equivalentPads ? { config: { equivalentPads: lesson.equivalentPads } } : {}),
      },
    );
    grader.onEvent((event) => {
      if (event.type === 'hit') {
        const v = event.verdict;
        model.applyVerdict(event.hit, v);
        lessonFeedbackEl.textContent = `${PAD_LABELS[event.hit.pad]}: ${verdictText(v)}`;
        lessonFeedbackEl.className = `lesson-feedback ${verdictClass(v)}`;
        setGradeCell(event.hit, v);
        flashGrade(event.hit.pad, verdictLevel(v));
      } else if (event.type === 'revised') {
        model.applyVerdict(event.hit, event.verdict);
        setGradeCell(event.hit, event.verdict);
      } else if (event.type === 'missed') {
        model.markMissed(event.note);
        lessonFeedbackEl.textContent = `${PAD_LABELS[event.note.pad]}: missed`;
        lessonFeedbackEl.className = 'lesson-feedback g-missed';
        logMissed(event.note);
        flashGrade(event.note.pad, 'bad');
      }
    });
    grader.start();

    lessonStarting = false;
    lessonRun = { lesson, loop, grader, nextPass: 0, passWindows: new Map(), accuracies: [] };
    lessonStatusEl.textContent = loop ? 'Count-in… then play. Looping until you press Stop.' : 'Count-in… then play.';
    updateLessonControls();
  })();
}

/** Stop the current lesson run or preview (if any) and the metronome. */
function stopLesson(message: string): void {
  lessonGeneration++;
  const run = lessonRun;
  lessonRun = null;
  previewRun = null;
  lessonStarting = false;
  cancelLesson = null;
  freezeHighway();
  if (run) {
    const final = run.grader.stop();
    // Show the final batch grade on the highway, so it agrees with the summary.
    highwayView?.model.syncResults(final.results);
  }
  if (metronome.isRunning) stopMetronome();
  lessonStatusEl.textContent = message;
  lessonStatusEl.classList.remove('running');
  updateLessonControls();
}

/** Called every animation frame: report each pass once its last note's window has passed. */
function lessonFrame(now: number): void {
  const run = lessonRun;
  if (!run) return;
  const { lesson } = run;
  const k = run.nextPass;

  const bpm = metronome.getSettings().bpm;
  let passWin = run.passWindows.get(k);
  if (!passWin || passWin.bpm !== bpm) {
    const lessonMs = (lesson.bars * lesson.beatsPerBar * 60_000) / bpm;
    const start = barStartTime(k * lesson.bars, now, 2 * lessonMs + 5000);
    const end = barStartTime((k + 1) * lesson.bars, now, 2 * lessonMs + 5000);
    if (start === null || end === null) return; // not projected yet
    const notes = lessonToExpectedNotes(lesson, metronome.getGrid(start, end), { passes: Infinity }).filter((n) => notePass(n.id) === k);
    // Only trust the window once every note of the pass is in the grid; otherwise retry next frame.
    if (notes.length !== lesson.notes.length) return;
    passWin = { bpm, start, end, lastNote: notes.at(-1)!.time };
    run.passWindows.set(k, passWin);
  }

  const windowMs = DEFAULT_GRADING_CONFIG.windowMs;
  if (now <= passWin.lastNote + windowMs + PASS_REPORT_GRACE_MS) return;

  // Pass k is over. Single run: final batch grade. Loop: this pass's slice of the live grade.
  let summary: GradeSummary;
  if (!run.loop) {
    const final = run.grader.stop();
    highwayView?.model.syncResults(final.results);
    summary = final.summary;
  } else {
    summary = summarize(resultForPass(run.grader.getResults(), k, passWin.start - windowMs, passWin.end - windowMs));
    run.passWindows.delete(k);
  }
  run.nextPass = k + 1;
  if (summary.expected !== lesson.notes.length) {
    // Should never happen; make it visible rather than silently grading a partial pass.
    console.warn(`Pass ${k + 1} of "${lesson.id}" graded ${summary.expected} notes, expected ${lesson.notes.length}.`);
  }
  showPassSummary(run, k, summary);
  if (!run.loop) {
    lessonRun = null; // already graded; stopLesson must not stop the grader again
    stopLesson('Done. Press Start to play it again.');
  }
}

function showPassSummary(run: LessonRun, pass: number, summary: GradeSummary): void {
  const accuracy = summary.accuracy ?? 0;
  run.accuracies.push(accuracy);
  const previousBest = bestAccuracy.get(run.lesson.id);
  const isBest = previousBest === undefined || accuracy > previousBest;
  if (isBest) bestAccuracy.set(run.lesson.id, accuracy);
  renderLessonPicker();

  const best = bestAccuracy.get(run.lesson.id)!;
  const heading = node('h3', '', `Pass ${pass + 1}: ${fmtPct(summary.accuracy)}${isBest ? ' · new session best!' : ` · session best ${fmtPct(best)}`}`);
  const parts: HTMLElement[] = [heading, ...buildSummary(summary)];
  if (summary.expected !== run.lesson.notes.length) {
    parts.push(node('p', 'scenario-check fail', `Only ${summary.expected} of the lesson's ${run.lesson.notes.length} notes were graded in this pass. Please report this.`));
  }
  lessonSummaryEl.replaceChildren(node('div', 'summary', undefined, parts));

  const topAccuracy = Math.max(...run.accuracies);
  lessonHistoryEl.replaceChildren(
    ...run.accuracies.map((a, i) => node('span', a === topAccuracy ? 'pass-chip best' : 'pass-chip', `Pass ${i + 1}: ${fmtPct(a)}`)),
  );
}

renderLessonPicker();
showLesson(selectedLesson());
updateLessonControls();

// Dev-server only: handles for poking at the app from the console or a browser test script.
// Vite strips this from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  Object.assign(window, { __drumly: { metronome, manager, TestSource, ALL_LESSONS, lessonToExpectedNotes, highwayView: () => highwayView } });
}
