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
import { LiveGrader, DEFAULT_GRADING_CONFIG, summarize, type ExpectedNote, type GradeResult, type GradeSummary, type HitVerdict } from './grading';
import { GRADE_BARS, GRADE_BPM, GRADE_SCENARIOS, checkSummary, rockBeatNotes, type GradeScenario } from './gradeScenarios';
import { Metronome, MAX_BPM, MIN_BPM, SUBDIVISIONS, isClickMode, type ClickMode, type MetronomeClick, type Subdivision } from './metronome';
import {
  ALL_LESSONS,
  SPEED_OPTIONS,
  LessonParseError,
  drumGainForPass,
  focusResult,
  gradedNotesOnly,
  sectionLesson,
  turnPlan,
  type TurnPlan,
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
import { HighwayModel, HighwayRenderer, KIT_ORDER, type PassStyle } from './highway';
import { DrumKit, LessonSounds, isHitSoundMode, shouldPlayHitSound, type HitSoundMode } from './sound';
import { CORRECT_PAN, YOURS_PAN, compareSchedule, compareTimelines, moveResult, replayClicks, type CompareMode, type PassTake } from './compare/compare';
import { gridStepMs, notesToText, quantizeHits, type RecordGrid, type RecordSubdivision } from './record/quantize';
import { CustomLessonStore, customLesson, isCustomLesson, type CustomLessonData } from './record/customLessons';
import { TrainerSession, defaultLadderSettings, passBpm, passVerdict, type LadderSettings, type PassVerdict, type TrainerPassReport } from './trainer';
import { PAD_LABELS, buildSummary, fmtPct, node } from './ui/summary';
import {
  browserSpeaker,
  buildSessionReport,
  coachingSpeech,
  fallbackLabel,
  fallbackNote,
  requestCoaching,
  ruleBasedCoaching,
  type CoachResponse,
  type SessionPass,
  type SessionReport,
} from './coach';
import { formatOffset, formatPctShort, formatTimingPhrase, passChipClass } from './ui/format';

const VERDICT_TITLES: Record<PassVerdict, string> = { clean: 'Clean pass', almost: 'Almost clean', rough: 'Rough pass' };

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

// ---- Drums -----------------------------------------------------------------

const drumsVolumeInput = el<HTMLInputElement>('drums-volume');
const clickVolumeInput = el<HTMLInputElement>('click-volume');
const hitSoundsSelect = el<HTMLSelectElement>('hit-sounds');
const guideInput = el<HTMLInputElement>('guide-drums');

/** Created on first use, on the metronome's AudioContext, so drums and clicks share one clock. */
let kit: DrumKit | null = null;
function drums(): DrumKit {
  kit ??= new DrumKit(metronome.getAudioContext(), Number(drumsVolumeInput.value) / 100);
  return kit;
}

/** The lesson the drums are playing along with the metronome, if any (preview, listen turns, guide). */
let lessonSounds: LessonSounds | null = null;
// Drums are booked as the metronome books each click: same lookahead, same audio clock, no timers.
metronome.onClick((click) => lessonSounds?.onClick(click));

let hitSoundMode: HitSoundMode = 'keyboard';

/** A fill being recorded (see "Record a fill"); declared here because the hit listener reads it. */
interface RecordRun {
  grid: RecordGrid;
  /** performance.now() ms of the downbeat after the last recorded bar. */
  end: number;
  model: HighwayModel;
}
let recordRun: RecordRun | null = null;

drumsVolumeInput.addEventListener('input', () => kit?.setVolume(Number(drumsVolumeInput.value) / 100));
clickVolumeInput.addEventListener('input', () => {
  metronome.setVolume(Number(clickVolumeInput.value) / 100);
  volumeInput.value = clickVolumeInput.value;
});
hitSoundsSelect.addEventListener('change', () => {
  hitSoundsSelect.blur();
  if (isHitSoundMode(hitSoundsSelect.value)) hitSoundMode = hitSoundsSelect.value;
});
guideInput.addEventListener('change', () => guideInput.blur());
for (const control of [drumsVolumeInput, clickVolumeInput]) control.addEventListener('change', () => control.blur());

/** Play a hit's drum sound right away (keyboard by default; the Roland module sounds on its own). */
function playHitSound(hit: Hit): void {
  if (!shouldPlayHitSound(hitSoundMode, hit.source)) return;
  const k = drums();
  k.play(hit.pad, hit.velocity, k.ctx.currentTime);
}

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
  // "perfect" next to "wrong pad" reads as a contradiction, so wrong-pad timing is in words.
  if (v.status === 'wrongPad') return `wrong pad (wanted ${PAD_LABELS[v.note.pad]}) · ${formatTimingPhrase(v.offsetMs)}`;
  return `hit · ${v.timing} ${formatOffset(v.offsetMs)}`;
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
  playHitSound(hit);
  flashPad(hit);
  logHit(hit);
  recordRun?.model.applyVerdict(hit, { hit, status: 'extra' });
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
  // Drums booked ahead for clicks that will now never sound are silenced too.
  lessonSounds = null;
  kit?.cancelScheduled();
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
volumeInput.addEventListener('input', () => {
  metronome.setVolume(Number(volumeInput.value) / 100);
  clickVolumeInput.value = volumeInput.value;
});
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
        ? `${passLabel(activeLesson, Math.floor(currentBeat.bar / activeLesson.lesson.bars))}Bar ${(currentBeat.bar % activeLesson.lesson.bars) + 1} of ${activeLesson.lesson.bars}`
        : recordRun
          ? `Recording · Bar ${currentBeat.bar + 1} of ${recordRun.grid.bars}`
          : `Bar ${currentBeat.bar + 1}`;
    showTurn(currentBeat.isCountIn ? null : currentBeat.bar);
  } else if (beatsEl.children.length === 0) {
    renderDots(metronome.getSettings().beatsPerBar);
  }

  lessonFrame(now);
  recordFrame(now);
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
const lessonTrainerInput = el<HTMLInputElement>('lesson-trainer');
const lessonListenInput = el<HTMLInputElement>('lesson-listen');
const lessonDeleteButton = el<HTMLButtonElement>('lesson-delete');
const trainerSettingsEl = el('trainer-settings');
const trainerStartInput = el<HTMLInputElement>('trainer-start');
const trainerTargetInput = el<HTMLInputElement>('trainer-target');
const trainerStepInput = el<HTMLInputElement>('trainer-step');
const trainerThresholdInput = el<HTMLInputElement>('trainer-threshold');
const trainerPassesInput = el<HTMLInputElement>('trainer-passes');
const trainerStatusEl = el('trainer-status');
const trainerBpmEl = el('trainer-bpm');
const trainerProgressEl = el('trainer-progress');
const trainerMessageEl = el('trainer-message');
const problemSpotsEl = el('problem-spots');
const problemListEl = el('problem-list');
const problemRefreshButton = el<HTMLButtonElement>('problem-refresh');
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
  /** What is played: the lesson, or in "Listen, then play" just the bars holding the fill. */
  lesson: Lesson;
  loop: boolean;
  /** Which passes are the app's turn and which are graded. */
  plan: TurnPlan;
  grader: LiveGrader;
  /** Trainer mode: the tempo ladder and problem spots. */
  trainer: TrainerSession | null;
  /** Next pass whose summary hasn't been shown yet. */
  nextPass: number;
  passWindows: Map<number, PassWindow>;
  /** One chip per reported pass. */
  chips: PassChip[];
  /** Every reported pass, for the coach. */
  passes: SessionPass[];
  /** Every reported pass with its timing, for Compare. */
  takes: PassTake[];
  /** Turn shown in the status line (listen mode), so it changes only once per turn. */
  shownTurn: number | null;
  /** performance.now() ms of bar 0's downbeat: the count-in text is cleared once it passes. */
  downbeat: number;
  countInShown: boolean;
}

interface PassChip {
  accuracy: number;
  /** The ladder's verdict on the pass (trainer settings, or the defaults outside the trainer). */
  verdict: PassVerdict;
  /** Tempo the pass was played at. */
  bpm: number;
  /** Set when the pass made the trainer speed up or slow down. */
  change: 'speedUp' | 'slowDown' | null;
}

/** Preview: the lesson plays once with the metronome, ungraded, flashing the pads on each note. */
interface PreviewRun {
  lesson: Lesson;
  loop: false;
  plan?: undefined;
  lastNoteId: string;
  /** Set once the last note has reached the now line. */
  endAt: number | null;
}

let lessonRun: LessonRun | null = null;
/** The Loop checkbox as the player last set it (the trainer overrides what it shows). */
let loopChoice = lessonLoopInput.checked;
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
      if (preview.endAt !== null && now >= preview.endAt) {
        stopLesson(isCustomLesson(preview.lesson) && !customLessons.includes(preview.lesson) ? 'Playback done. Save it to practice it.' : 'Preview done. Press Start to play it.');
      }
    } else if (lessonRun?.plan.listen) {
      // The app's turn: flash the pads as its drums play, like a preview.
      view.model.takePassed(now, (note) => {
        if (note.outlined) flashPreviewNote(note.pad, note.accent);
      });
    }
  }
  const replay = compareRun;
  if (replay) {
    replay.model.takePassed(now, (note) => flashPreviewNote(note.pad, note.accent));
    if (now >= replay.endAt) stopCompare('Compare done.');
  }
  highway.draw(highwayView?.frozenAt ?? now);
}

// ---- Lesson controls -----------------------------------------------------------

const CATEGORY_LABELS: Record<LessonCategory, string> = { beat: 'Beats', fill: 'Fills' };

/** Recorded fills, saved in localStorage (in memory only if storage is blocked). */
const customStore = new CustomLessonStore(() => window.localStorage);
let customLessons: Lesson[] = customStore.list();

function allLessons(): Lesson[] {
  return [...ALL_LESSONS, ...customLessons];
}

function selectedLesson(): Lesson {
  return allLessons().find((l) => l.id === lessonSelect.value) ?? ALL_LESSONS[0]!;
}

function renderLessonPicker(): void {
  const current = lessonSelect.value || ALL_LESSONS[0]!.id;
  const option = (l: Lesson) => {
    const best = bestAccuracy.get(l.id);
    const o = node('option', '', best === undefined ? l.title : `${l.title} (best ${fmtPct(best)})`);
    o.value = l.id;
    return o;
  };
  const group = (label: string, lessons: Lesson[]) => {
    const g = node('optgroup', '');
    g.label = label;
    g.append(...lessons.map(option));
    return g;
  };
  const groups = (Object.keys(CATEGORY_LABELS) as LessonCategory[]).map((category) => group(CATEGORY_LABELS[category], ALL_LESSONS.filter((l) => l.category === category)));
  groups.push(group('My fills', customLessons));
  lessonSelect.replaceChildren(...groups.filter((g) => g.children.length > 0));
  lessonSelect.value = allLessons().some((l) => l.id === current) ? current : ALL_LESSONS[0]!.id;
}

/** Two clicks to delete (no browser dialog): the first arms the button, the second deletes. */
let deleteArmed = false;
function resetDeleteButton(): void {
  deleteArmed = false;
  lessonDeleteButton.textContent = 'Delete fill';
  lessonDeleteButton.hidden = !isCustomLesson(selectedLesson());
}
lessonDeleteButton.addEventListener('click', () => {
  lessonDeleteButton.blur();
  const lesson = selectedLesson();
  if (!isCustomLesson(lesson)) return;
  if (!deleteArmed) {
    deleteArmed = true;
    lessonDeleteButton.textContent = `Really delete "${lesson.title}"?`;
    return;
  }
  const { persisted } = customStore.remove(lesson.id);
  customLessons = customStore.list();
  lessonSelect.value = ALL_LESSONS[0]!.id;
  renderLessonPicker();
  showLesson(selectedLesson());
  lessonStatusEl.textContent = persisted ? `Deleted "${lesson.title}".` : `Deleted "${lesson.title}" for this session (the browser blocked storage).`;
});

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
  const ladder = defaultLadderSettings(lesson);
  trainerStartInput.value = String(ladder.startBpm);
  trainerTargetInput.value = String(ladder.targetBpm);
  trainerStatusEl.hidden = true;
  problemSpotsEl.hidden = true;
  hideCoach();
  showHighway(new HighwayModel(lesson), null);
  resetDeleteButton();
  lastSession = null;
  renderCompareBar();
}

function updateLessonControls(): void {
  const active = lessonRun !== null || previewRun !== null || lessonStarting || recordRun !== null || recordStarting || compareRun !== null;
  lessonStartButton.textContent = active ? 'Stop' : 'Start';
  lessonStartButton.classList.toggle('playing', active);
  lessonPreviewButton.disabled = active;
  lessonSelect.disabled = active;
  const trainer = lessonTrainerInput.checked;
  // The trainer and listen mode always loop: show Loop checked and locked, and restore the player's choice after.
  const forcedLoop = trainer || lessonListenInput.checked;
  lessonLoopInput.disabled = active || forcedLoop;
  lessonLoopInput.checked = forcedLoop || loopChoice;
  lessonTrainerInput.disabled = active;
  lessonListenInput.disabled = active;
  lessonDeleteButton.disabled = active;
  const recording = recordRun !== null || recordStarting;
  recordButton.textContent = recording ? 'Stop recording' : 'Record';
  recordButton.classList.toggle('playing', recording);
  recordButton.disabled = active && !recording;
  for (const control of [recordPlayButton, recordSaveButton, recordBarsSelect, recordBpmInput, recordGridSelect]) control.disabled = active;
  compareModeSelect.disabled = active;
  comparePlayButton.disabled = active && compareRun === null;
  // In the trainer the ladder owns the tempo.
  const trainerRunning = active && trainer;
  lessonBpmInput.disabled = trainerRunning;
  lessonSpeedSelect.disabled = trainerRunning;
  trainerSettingsEl.hidden = !trainer;
  for (const input of [trainerStartInput, trainerTargetInput, trainerStepInput, trainerThresholdInput, trainerPassesInput]) input.disabled = active;
  problemRefreshButton.hidden = !(lessonRun?.trainer);
  highway.message = active ? '' : IDLE_MESSAGE;
}

/** Trainer settings from the inputs, clamped to sensible values. */
function trainerSettings(lesson: Lesson): LadderSettings {
  const defaults = defaultLadderSettings(lesson);
  const num = (input: HTMLInputElement, fallback: number, min: number, max: number) => {
    const v = Number(input.value);
    const value = input.value !== '' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    input.value = String(value);
    return value;
  };
  return {
    startBpm: num(trainerStartInput, defaults.startBpm, MIN_BPM, MAX_BPM),
    targetBpm: num(trainerTargetInput, defaults.targetBpm, MIN_BPM, MAX_BPM),
    stepBpm: num(trainerStepInput, defaults.stepBpm, 1, 50),
    passThreshold: num(trainerThresholdInput, defaults.passThreshold, 1, 100),
    passesNeeded: Math.round(num(trainerPassesInput, defaults.passesNeeded, 1, 10)),
  };
}

function showTrainerStatus(trainer: TrainerSession, message: string, tone: '' | 'up' | 'down' | 'done'): void {
  trainerStatusEl.hidden = false;
  trainerBpmEl.textContent = `${formatBpm(trainer.bpm)} BPM`;
  trainerProgressEl.textContent = trainer.progress();
  // The progress line already says "Fill learned at …" when done.
  trainerMessageEl.textContent = trainer.done ? 'Nice work!' : message;
  trainerMessageEl.className = `trainer-message ${tone}`;
}

function showProblemSpots(trainer: TrainerSession): void {
  const spots = trainer.problems.worst(3);
  problemSpotsEl.hidden = false;
  problemListEl.replaceChildren(
    ...(spots.length > 0
      ? spots.map((spot) => node('li', '', trainer.problems.describe(spot, (pad) => PAD_LABELS[pad])))
      : [node('li', 'none', trainer.reports.length > 0 ? 'No problem spots yet. Keep going.' : 'Play a pass first.')]),
  );
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
lessonLoopInput.addEventListener('change', () => {
  lessonLoopInput.blur();
  loopChoice = lessonLoopInput.checked;
});
lessonTrainerInput.addEventListener('change', () => {
  lessonTrainerInput.blur();
  updateLessonControls();
});
lessonListenInput.addEventListener('change', () => {
  lessonListenInput.blur();
  updateLessonControls();
});
for (const input of [trainerStartInput, trainerTargetInput, trainerStepInput, trainerThresholdInput, trainerPassesInput]) {
  input.addEventListener('change', () => {
    trainerSettings(selectedLesson()); // normalizes the values shown
    input.blur();
  });
}
problemRefreshButton.addEventListener('click', () => {
  problemRefreshButton.blur();
  if (lessonRun?.trainer) showProblemSpots(lessonRun.trainer);
});

lessonStartButton.addEventListener('click', () => {
  lessonStartButton.blur();
  if (recordRun || recordStarting) cancelRecording('Recording stopped.');
  else if (compareRun) stopCompare();
  else if (lessonRun || previewRun || lessonStarting) stopLesson('Stopped.');
  else if (lessonTrainerInput.checked) startLesson(selectedLesson(), true, 'trainer');
  else startLesson(selectedLesson(), loopChoice, 'play');
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
function startLesson(lesson: Lesson, loop: boolean, mode: 'play' | 'preview' | 'trainer', bpmOverride?: number): void {
  if (metronome.isRunning) stopMetronome(); // also stops grade tests and test patterns
  stopCompare();
  // "Listen, then play": the app plays the fill's bars, then the player does, alternating until Stop.
  const listen = mode !== 'preview' && lessonListenInput.checked;
  const played = listen ? sectionLesson(lesson) : lesson;
  const plan = turnPlan(played.bars, listen);
  loop ||= listen;
  const trainer = mode === 'trainer' ? new TrainerSession(played, trainerSettings(lesson)) : null;
  const bpm = trainer ? trainer.bpm : (bpmOverride ?? lessonBpm(lesson));
  if (trainer) lessonBpmInput.value = formatBpm(bpm);
  applyMetronomeSettings({ bpm, beatsPerBar: lesson.beatsPerBar, subdivision: lesson.subdivision, countIn: true });
  problemSpotsEl.hidden = true;
  trainerStatusEl.hidden = true;
  hideCoach();
  lastSession = null;
  renderCompareBar();
  const graded = listen ? 'only your turns are graded' : 'the groove is played but only the shaded fill is graded';
  if (trainer) showTrainerStatus(trainer, `Count-in… then ${listen ? 'listen' : 'play'}. ${capitalize(graded)}.`, '');
  lessonStarting = true;
  updateLessonControls();
  lessonHistoryEl.replaceChildren();
  lessonSummaryEl.replaceChildren();
  lessonFeedbackEl.textContent = '';
  lessonStatusEl.textContent = 'Starting…';
  lessonStatusEl.classList.add('running');
  const passes = loop ? Infinity : 1;
  // Drums: the whole lesson for a preview; the app's turns (and the guide, if on) otherwise.
  // Set before the metronome starts, so the very first clicks are covered.
  lessonSounds = new LessonSounds(played, (pad, velocity, when, options) => drums().play(pad, velocity, when, options), {
    passes,
    gainForPass: mode === 'preview' ? () => 1 : drumGainForPass(plan, () => guideInput.checked),
  });
  // The highway starts with the metronome, so the count-in is visible.
  const model = new HighwayModel(played, { passes, ...(listen ? { passStyle: listenStyle(plan) } : {}) });
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
      previewRun = { lesson: played, loop: false, lastNoteId: noteId(played.id, 0, played.notes.length - 1), endAt: null };
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
      // In listen mode only the player's turns are graded.
      gradedNotesOnly(lessonNoteSource(played, getGrid, { passes }), plan),
      {
        ignoreHitsBefore: downbeat - DEFAULT_GRADING_CONFIG.windowMs,
        ...(played.equivalentPads ? { config: { equivalentPads: played.equivalentPads } } : {}),
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
    // Every hit of the run, exactly as played, for Compare.
    manager.startRecording();

    lessonStarting = false;
    lessonRun = {
      lesson: played,
      loop,
      plan,
      grader,
      trainer,
      nextPass: plan.firstGraded,
      passWindows: new Map(),
      chips: [],
      passes: [],
      takes: [],
      shownTurn: null,
      downbeat,
      countInShown: true,
    };
    lessonStatusEl.textContent = listen
      ? 'Count-in… then listen. Your turn comes after. Looping until you press Stop.'
      : loop
        ? 'Count-in… then play. Looping until you press Stop.'
        : 'Count-in… then play.';
    updateLessonControls();
  })();
}

/** Listen turns: outlined notes labelled "Listen"; player turns: normal notes labelled "Your turn". */
function listenStyle(plan: TurnPlan): (pass: number) => PassStyle {
  return (pass) => (plan.turn(pass) === 'listen' ? { label: 'Listen', outlined: true } : { label: 'Your turn', outlined: false });
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Listen · ", "Your turn · ", "Pass 3 · " or nothing, for the bar label. */
function passLabel(active: { loop: boolean; plan?: TurnPlan | undefined }, pass: number): string {
  if (active.plan?.listen) return active.plan.turn(pass) === 'listen' ? 'Listen · ' : 'Your turn · ';
  return active.loop ? `Pass ${pass + 1} · ` : '';
}

/** In listen mode: the highway banner and status line follow the turn being heard. */
function showTurn(bar: number | null): void {
  const run = lessonRun;
  if (!run?.plan.listen) {
    if (!compareRun) highway.banner = null;
    return;
  }
  if (bar === null) return;
  const pass = Math.floor(bar / run.lesson.bars);
  const listen = run.plan.turn(pass) === 'listen';
  highway.banner = listen ? { text: 'Listen', tone: 'listen' } : { text: 'Your turn', tone: 'play' };
  if (run.shownTurn === pass) return;
  run.shownTurn = pass;
  lessonStatusEl.textContent = listen ? 'Listen: the app plays it. Your turn is next.' : 'Your turn: play it back. Only this turn is graded.';
}

/** Stop the current lesson run or preview (if any) and the metronome. */
function stopLesson(message: string, finished: LessonRun | null = null): void {
  lessonGeneration++;
  const run = lessonRun;
  lessonRun = null;
  previewRun = null;
  lessonStarting = false;
  cancelLesson = null;
  highway.banner = null;
  freezeHighway();
  if (run) {
    const final = run.grader.stop();
    // Show the final batch grade on the highway, so it agrees with the summary.
    highwayView?.model.syncResults(final.results);
    if (run.trainer) showProblemSpots(run.trainer);
  }
  if (metronome.isRunning) stopMetronome();
  lessonStatusEl.textContent = message;
  lessonStatusEl.classList.remove('running');
  const ended = run ?? finished;
  // The run's hits, exactly as played, stay available for Compare.
  const hits = manager.isRecording && ended ? manager.stopRecording() : [];
  if (ended && ended.takes.length > 0) {
    lastSession = { takes: ended.takes, hits, selected: ended.takes.length - 1, plan: ended.plan };
  }
  updateLessonControls();
  renderCompareBar();
  if (ended) {
    renderChips(ended);
    showCoach(ended);
  }
}

/** Called every animation frame: report each pass once its last note's window has passed. */
function lessonFrame(now: number): void {
  const run = lessonRun;
  if (!run) return;
  const { lesson } = run;
  const k = run.nextPass;

  if (run.countInShown && now >= run.downbeat) {
    run.countInShown = false;
    // In listen mode the status line follows the turns (showTurn).
    if (!run.plan.listen) lessonStatusEl.textContent = run.loop ? 'Looping until you press Stop.' : '';
    if (run.trainer && run.trainer.reports.length === 0) trainerMessageEl.textContent = run.plan.listen ? 'Only your turns are graded.' : 'Only the shaded fill is graded.';
  }

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
  let result: GradeResult;
  if (!run.loop) {
    const final = run.grader.stop();
    highwayView?.model.syncResults(final.results);
    result = final.results;
  } else {
    result = resultForPass(run.grader.getResults(), k, passWin.start - windowMs, passWin.end - windowMs);
    run.passWindows.delete(k);
  }
  run.nextPass = run.plan.nextGraded(k);
  const full = summarize(result);
  if (full.expected !== lesson.notes.length) {
    // Should never happen; make it visible rather than silently grading a partial pass.
    console.warn(`Pass ${k + 1} of "${lesson.id}" graded ${full.expected} notes, expected ${lesson.notes.length}.`);
  }
  const playedBpm = passBpm(lesson, passWin.start, passWin.end);
  const report = run.trainer ? trainerPass(run, run.trainer, k, result, playedBpm) : null;
  run.passes.push({ bpm: playedBpm, result, ...(report ? { change: report.change } : {}) });
  run.takes.push({ lesson, pass: k, start: passWin.start, end: passWin.end, bpm: playedBpm, result });
  const focus = report ? report.focus : summarize(focusResult(result, lesson, windowMs));
  showPassSummary(run, k, focus, full, report, playedBpm);
  if (!run.loop) {
    lessonRun = null; // already graded; stopLesson must not stop the grader again
    stopLesson('Done. Press Start to play it again.', run);
  } else if (run.trainer?.done) {
    stopLesson(`Fill learned at ${formatBpm(run.trainer.bpm)} BPM!`);
  }
}

/** Feed a pass to the trainer, and book any tempo change for the next pass start that isn't scheduled yet. */
function trainerPass(run: LessonRun, trainer: TrainerSession, pass: number, result: GradeResult, playedBpm: number): TrainerPassReport {
  const report = trainer.recordPass(pass, result, playedBpm);
  if (report.change === 'speedUp' || report.change === 'slowDown') {
    // The next pass start (in listen mode, the next listen turn) whose downbeat isn't booked yet.
    const bar = run.plan.changeBar(metronome.nextUnscheduledBar());
    // Commits through the scheduler's beat-boundary logic exactly at that downbeat: nothing moves or doubles.
    if (!metronome.setBpmAtBar(trainer.bpm, bar)) console.warn(`Could not book ${trainer.bpm} BPM at bar ${bar}.`);
    lessonBpmInput.value = formatBpm(trainer.bpm);
  }
  const tone = report.change === 'speedUp' ? 'up' : report.change === 'slowDown' ? 'down' : report.change === 'finished' ? 'done' : '';
  showTrainerStatus(trainer, report.message, tone);
  // Ring the worst notes so they stand out on the next pass.
  highwayView?.model.setHighlights(trainer.problems.worst(3).map((p) => p.stats.index));
  if (!problemSpotsEl.hidden) showProblemSpots(trainer);
  return report;
}

/**
 * Headline: the focus range (the fill) if the lesson has one; whole-lesson stats stay available below.
 */
function showPassSummary(run: LessonRun, pass: number, summary: GradeSummary, full: GradeSummary, report: TrainerPassReport | null, playedBpm: number): void {
  const accuracy = summary.accuracy ?? 0;
  const change = report?.change === 'speedUp' || report?.change === 'slowDown' ? report.change : null;
  const ladder = run.trainer?.settings ?? defaultLadderSettings(run.lesson);
  run.chips.push({ accuracy, verdict: passVerdict(summary.accuracy, ladder), bpm: playedBpm, change });
  const previousBest = bestAccuracy.get(run.lesson.id);
  const isBest = previousBest === undefined || accuracy > previousBest;
  if (isBest) bestAccuracy.set(run.lesson.id, accuracy);
  renderLessonPicker();

  const best = bestAccuracy.get(run.lesson.id)!;
  const focused = run.lesson.focus !== undefined;
  const at = report ? ` at ${formatBpm(report.bpm)} BPM` : '';
  const heading = node('h3', '', `Pass ${run.plan.gradedNumber(pass)}${at}: ${fmtPct(summary.accuracy)}${focused ? ' on the fill' : ''}${isBest ? ' · new session best!' : ` · session best ${fmtPct(best)}`}`);
  const parts: HTMLElement[] = [heading, ...buildSummary(summary)];
  if (focused) {
    parts.push(node('details', 'full-stats', undefined, [node('summary', '', `Whole lesson, groove included: ${fmtPct(full.accuracy)}`), node('div', 'summary', undefined, buildSummary(full))]));
  }
  if (full.expected !== run.lesson.notes.length) {
    parts.push(node('p', 'scenario-check fail', `Only ${full.expected} of the lesson's ${run.lesson.notes.length} notes were graded in this pass. Please report this.`));
  }
  lessonSummaryEl.replaceChildren(node('div', 'summary', undefined, parts));

  renderChips(run);
}

/** One chip per graded pass. After the run, a chip can be clicked to pick the pass Compare plays. */
function renderChips(run: LessonRun): void {
  const topAccuracy = Math.max(...run.chips.map((c) => c.accuracy));
  const session = lastSession && lastSession.takes === run.takes ? lastSession : null;
  lessonHistoryEl.replaceChildren(
    ...run.chips.map((c, i) => {
      const isTop = c.accuracy === topAccuracy;
      const selected = session?.selected === i;
      const chip = node('span', `${passChipClass(c.verdict, isTop)}${session ? ' selectable' : ''}${selected ? ' selected' : ''}`, `${isTop ? '★ ' : ''}Pass ${i + 1} · ${formatBpm(Math.round(c.bpm * 10) / 10)} BPM · ${formatPctShort(c.accuracy)}`);
      chip.title = `${VERDICT_TITLES[c.verdict]}${isTop ? ' · session best' : ''}`;
      if (c.change) {
        chip.append(node('span', `pass-arrow ${c.change === 'speedUp' ? 'up' : 'down'}`, c.change === 'speedUp' ? ' ↑' : ' ↓'));
        chip.title += c.change === 'speedUp' ? ' · sped the trainer up' : ' · slowed the trainer down';
      }
      if (session) {
        chip.title += ' · click to compare this pass';
        chip.addEventListener('click', () => {
          if (compareRun) return;
          session.selected = i;
          renderChips(run);
          renderCompareBar();
        });
      }
      return chip;
    }),
  );
}

// ---- Compare -------------------------------------------------------------------

const compareBarEl = el('compare-bar');
const comparePlayButton = el<HTMLButtonElement>('compare-play');
const compareModeSelect = el<HTMLSelectElement>('compare-mode');
const compareInfoEl = el('compare-info');

/** The last finished run's graded passes and every hit of it (from the InputManager recording). */
let lastSession: { takes: PassTake[]; hits: Hit[]; selected: number; plan: TurnPlan } | null = null;
/** A compare replay in progress: its highway and when it ends (performance.now() ms). */
let compareRun: { model: HighwayModel; endAt: number } | null = null;

function renderCompareBar(): void {
  const session = lastSession;
  compareBarEl.hidden = !session;
  if (!session) return;
  comparePlayButton.textContent = compareRun ? 'Stop' : 'Compare';
  comparePlayButton.classList.toggle('playing', compareRun !== null);
  const take = session.takes[session.selected]!;
  compareInfoEl.textContent = `Pass ${session.plan.gradedNumber(take.pass)} at ${formatBpm(Math.round(take.bpm * 10) / 10)} BPM. Click a pass above to pick another.`;
}

function selectedCompareMode(): CompareMode {
  return compareModeSelect.value === 'together' ? 'together' : 'sequential';
}

/** performance.now() ms at which AudioContext time `t` is heard (for drawing only; sound is booked on the audio clock). */
function heardAt(ctx: AudioContext, t: number): number {
  const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : undefined;
  if (stamp?.contextTime && stamp.performanceTime) return stamp.performanceTime + (t - stamp.contextTime) * 1000;
  return performance.now() + (t - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
}

/**
 * Play the selected pass: the correct version, a short gap, then the player's own hits exactly as
 * recorded (or both at once, panned apart). Every sound is booked up front at an exact
 * AudioContext time. The highway replays alongside on the same timeline. Call from a click handler.
 */
function playCompare(): void {
  const session = lastSession;
  if (!session || compareRun || lessonRun || previewRun || lessonStarting || recordRun || recordStarting) return;
  if (metronome.isRunning) stopMetronome();
  const take = session.takes[session.selected]!;
  const mode = selectedCompareMode();
  const timelines = compareTimelines(take, session.hits, DEFAULT_GRADING_CONFIG.windowMs);
  const schedule = compareSchedule(timelines, mode);
  const k = drums();
  const t0 = k.ctx.currentTime + 0.15;
  const together = mode === 'together';
  for (const e of timelines.correct) k.play(e.pad, e.velocity, t0 + (schedule.correctStartMs + e.atMs) / 1000, together ? { pan: CORRECT_PAN } : {});
  for (const e of timelines.yours) k.play(e.pad, e.velocity, t0 + (schedule.yoursStartMs + e.atMs) / 1000, together ? { pan: YOURS_PAN } : {});

  // The highway: in sequence, pass 0 is the correct version (outlined) and pass 1 is yours, graded.
  const perf0 = heardAt(k.ctx, t0);
  const starts = together ? [perf0 + schedule.correctStartMs] : [perf0 + schedule.correctStartMs, perf0 + schedule.yoursStartMs];
  const yoursPass = starts.length - 1;
  const style = (pass: number): PassStyle =>
    together ? { label: 'Correct (left) + yours (right)', outlined: false } : pass === 0 ? { label: 'Correct', outlined: true } : { label: 'Yours', outlined: false };
  // Keep everything for the whole replay: it's short, and the grade is applied up front.
  const model = new HighwayModel(take.lesson, { passes: starts.length, pastMs: 1e9, futureMs: 1e9, passStyle: style });
  const clicks = replayClicks(take.lesson, take.bpm, starts);
  model.refresh(performance.now(), () => clicks, true);
  model.syncResults(moveResult(take.result, take.lesson, yoursPass, starts[yoursPass]! - take.start));
  // The correct side's notes flash as they pass; the player's notes were already "played".
  for (const note of model.notes) if (!note.outlined && !together) note.passed = true;
  compareRun = { model, endAt: perf0 + schedule.totalMs };
  showHighway(model, null);
  highway.banner = together ? { text: 'Correct + yours', tone: 'listen' } : null;
  lessonStatusEl.textContent = together
    ? `Both at once: correct on the left, yours on the right (pass ${session.plan.gradedNumber(take.pass)}).`
    : `Correct version, then yours (pass ${session.plan.gradedNumber(take.pass)}).`;
  updateLessonControls();
  renderCompareBar();
}

function stopCompare(message?: string): void {
  if (!compareRun) return;
  compareRun = null;
  kit?.cancelScheduled();
  highway.banner = null;
  freezeHighway();
  if (message) lessonStatusEl.textContent = message;
  updateLessonControls();
  renderCompareBar();
}

comparePlayButton.addEventListener('click', () => {
  comparePlayButton.blur();
  if (compareRun) stopCompare('Stopped.');
  else playCompare();
});
compareModeSelect.addEventListener('change', () => compareModeSelect.blur());

// ---- Record a fill ---------------------------------------------------------------

const recordPanelEl = el<HTMLDetailsElement>('record-panel');
const recordBarsSelect = el<HTMLSelectElement>('record-bars');
const recordBpmInput = el<HTMLInputElement>('record-bpm');
const recordGridSelect = el<HTMLSelectElement>('record-grid');
const recordButton = el<HTMLButtonElement>('record-start');
const recordStatusEl = el('record-status');
const recordResultEl = el('record-result');
const recordTextInput = el<HTMLTextAreaElement>('record-text');
const recordErrorEl = el('record-error');
const recordTitleInput = el<HTMLInputElement>('record-title');
const recordPlayButton = el<HTMLButtonElement>('record-play');
const recordSaveButton = el<HTMLButtonElement>('record-save');

/** Lanes while recording: the whole kit, so any hit has a lane. */
const RECORD_LANES = KIT_ORDER.filter((p) => p !== 'crash2' && p !== 'snareRim' && p !== 'crossStick' && p !== 'rideBell');
let recordStarting = false;
let recordGeneration = 0;
/** What was recorded: the grid it was played on, edited as text. */
let recordDraft: { bpm: number; bars: number; subdivision: RecordSubdivision } | null = null;

function recordSettings(): { bpm: number; bars: number; subdivision: RecordSubdivision } {
  const bpm = Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, Number(recordBpmInput.value) || 70)));
  recordBpmInput.value = String(bpm);
  const bars = Math.min(4, Math.max(1, Math.round(Number(recordBarsSelect.value)) || 2));
  const subdivision: RecordSubdivision = recordGridSelect.value === 'triplet' ? 'triplet' : 'sixteenth';
  return { bpm, bars, subdivision };
}

/** Must be called synchronously from a click handler: it starts audio. */
function startRecording(): void {
  if (lessonRun || previewRun || lessonStarting) stopLesson('Stopped.');
  stopCompare();
  if (metronome.isRunning) stopMetronome();
  const { bpm, bars, subdivision } = recordSettings();
  applyMetronomeSettings({ bpm, beatsPerBar: 4, subdivision, countIn: true });
  const display: Lesson = { id: 'recording', title: 'Recording', category: 'fill', description: '', defaultBpm: bpm, beatsPerBar: 4, bars, subdivision, notes: [] };
  const model = new HighwayModel(display, { lanes: RECORD_LANES });
  showHighway(model, null);
  recordResultEl.hidden = true;
  recordStatusEl.textContent = 'Starting…';
  recordStatusEl.classList.add('running');
  recordStarting = true;
  updateLessonControls();
  highway.message = '';
  const starting = startMetronome();
  const generation = ++recordGeneration;

  void (async () => {
    await starting;
    await waitForClockSync();
    if (generation !== recordGeneration) return;
    const downbeat = bar0Downbeat();
    const barMs = (4 * 60_000) / bpm;
    const end = downbeat === null ? null : barStartTime(bars, downbeat, bars * barMs + 2000);
    if (!metronome.isRunning || downbeat === null || end === null) {
      cancelRecording('Could not start in time. Press Record again.');
      return;
    }
    // Hits are captured from the start; the quantizer keeps only those inside the recorded bars.
    manager.startRecording();
    recordStarting = false;
    recordRun = { grid: { startTime: downbeat, bpm, bars, beatsPerBar: 4, subdivision }, end, model };
    recordStatusEl.textContent = `Count-in… then play your fill. Recording ${bars} bar${bars === 1 ? '' : 's'} at ${bpm} BPM.`;
    updateLessonControls();
  })();
}

function cancelRecording(message: string): void {
  recordGeneration++;
  recordStarting = false;
  const wasRecording = recordRun !== null;
  recordRun = null;
  if (wasRecording && manager.isRecording) manager.stopRecording();
  if (metronome.isRunning) stopMetronome();
  freezeHighway();
  recordStatusEl.textContent = message;
  recordStatusEl.classList.remove('running');
  updateLessonControls();
}

/** Called every animation frame: once the last bar (and half a step) has passed, quantize what was played. */
function recordFrame(now: number): void {
  const run = recordRun;
  if (!run || now < run.end + gridStepMs(run.grid) / 2 + 30) return;
  recordRun = null;
  const hits = manager.isRecording ? manager.stopRecording() : [];
  if (metronome.isRunning) stopMetronome();
  freezeHighway();
  recordStatusEl.classList.remove('running');
  const notes = quantizeHits(hits, run.grid);
  updateLessonControls();
  if (notes.length === 0) {
    recordStatusEl.textContent = 'No hits were recorded. Press Record to try again.';
    return;
  }
  recordDraft = { bpm: run.grid.bpm, bars: run.grid.bars, subdivision: run.grid.subdivision };
  recordTextInput.value = notesToText(notes, run.grid);
  recordTitleInput.value = '';
  recordResultEl.hidden = false;
  recordStatusEl.textContent = `Recorded ${notes.length} note${notes.length === 1 ? '' : 's'}, snapped to the nearest ${run.grid.subdivision === 'triplet' ? 'triplet' : '16th'}. Fix the text if needed, then save it.`;
  previewDraft();
}

/** The draft as a lesson, or null (with the reason shown) if the text doesn't parse. */
function draftLesson(id = 'my-draft'): { lesson: Lesson; data: CustomLessonData } | null {
  if (!recordDraft) return null;
  const data: CustomLessonData = { id, title: recordTitleInput.value.trim() || defaultFillTitle(), beatsPerBar: 4, text: recordTextInput.value, ...recordDraft };
  try {
    const lesson = customLesson(data);
    recordErrorEl.textContent = lesson.notes.length === 0 ? 'The text has no notes.' : '';
    return lesson.notes.length === 0 ? null : { lesson, data };
  } catch (error) {
    recordErrorEl.textContent = error instanceof LessonParseError ? error.message : errorMessage(error);
    return null;
  }
}

function defaultFillTitle(): string {
  return `My fill ${customLessons.length + 1}`;
}

/** Show the draft on the highway, standing still with bar 1 just past the now line. */
function previewDraft(): void {
  const draft = draftLesson();
  if (!draft) return;
  const t = performance.now();
  const model = new HighwayModel(draft.lesson, { pastMs: 1e9, futureMs: 1e9 });
  const clicks = replayClicks(draft.lesson, draft.lesson.defaultBpm, [t + 200]);
  model.refresh(t, () => clicks, true);
  showHighway(model, t);
  highway.message = '';
}

recordButton.addEventListener('click', () => {
  recordButton.blur();
  if (recordRun || recordStarting) cancelRecording('Recording stopped.');
  else startRecording();
});
recordTextInput.addEventListener('input', () => previewDraft());
recordPlayButton.addEventListener('click', () => {
  recordPlayButton.blur();
  const draft = draftLesson();
  if (!draft || lessonRun || previewRun || lessonStarting) return;
  startLesson(draft.lesson, false, 'preview', draft.lesson.defaultBpm);
});
recordSaveButton.addEventListener('click', () => {
  recordSaveButton.blur();
  const draft = draftLesson(customStore.newId());
  if (!draft) return;
  const { lesson, persisted } = customStore.save(draft.data);
  customLessons = customStore.list();
  renderLessonPicker();
  lessonSelect.value = lesson.id;
  showLesson(lesson);
  recordResultEl.hidden = true;
  recordDraft = null;
  recordPanelEl.open = false;
  lessonStatusEl.textContent = persisted
    ? `Saved "${lesson.title}" under My fills. Try it in the Trainer.`
    : `Saved "${lesson.title}" for this session only: the browser blocked storage, so it will be gone after a reload.`;
});
for (const control of [recordBarsSelect, recordBpmInput, recordGridSelect]) control.addEventListener('change', () => control.blur());

// ---- Coach ---------------------------------------------------------------------

const coachEl = el('coach');
const coachTitleEl = el('coach-title');
const coachSourceEl = el('coach-source');
const coachSpeakInput = el<HTMLInputElement>('coach-speak');
const coachGetButton = el<HTMLButtonElement>('coach-get');
const coachHeadlineEl = el('coach-headline');
const coachWellEl = el('coach-well');
const coachFixEl = el('coach-fix');
const coachNextEl = el('coach-next');
const coachNoteEl = el('coach-note');
const speaker = browserSpeaker();

/** The report the panel is showing, and a counter so a late answer for an old session is ignored. */
let coachReport: SessionReport | null = null;
let coachGeneration = 0;
let coachShown: CoachResponse | null = null;

function hideCoach(): void {
  coachGeneration++;
  coachReport = null;
  coachShown = null;
  coachEl.hidden = true;
  speaker.stop();
}

/** After a session: quick tips straight away; "Get coaching" asks Claude (via the local server). */
function showCoach(run: LessonRun): void {
  hideCoach();
  if (run.passes.length === 0) return;
  const trainer = run.trainer;
  coachReport = buildSessionReport({
    lesson: run.lesson,
    passes: run.passes,
    ...(trainer ? { trainer: { settings: trainer.settings, learned: trainer.done, finalBpm: trainer.bpm } } : {}),
  });
  coachGetButton.disabled = false;
  coachGetButton.textContent = 'Get coaching';
  renderCoaching({ source: 'rules', coaching: ruleBasedCoaching(coachReport) }, '');
}

function renderCoaching(response: CoachResponse, note: string): void {
  const { coaching } = response;
  coachShown = response;
  coachEl.hidden = false;
  coachTitleEl.textContent = response.source === 'claude' ? 'Coach' : 'Quick tips';
  // A fallback says why right next to the heading, so a key problem reads differently from a request problem.
  coachSourceEl.textContent = response.source === 'claude' ? 'from Claude' : fallbackLabel(response.reason);
  coachSourceEl.classList.toggle('warn', response.source === 'rules' && response.reason !== undefined && response.reason !== 'no-key');
  coachHeadlineEl.textContent = coaching.headline;
  const list = (items: string[], empty: string) => (items.length > 0 ? items.map((t) => node('li', '', t)) : [node('li', 'none', empty)]);
  coachWellEl.replaceChildren(...list(coaching.wentWell, '—'));
  coachFixEl.replaceChildren(...list(coaching.fixThis, 'Nothing stood out. Keep going.'));
  coachNextEl.textContent = coaching.nextExercise;
  coachNoteEl.textContent = note;
  if (coachSpeakInput.checked) speaker.speak(coachingSpeech(coaching));
}

coachGetButton.addEventListener('click', () => {
  coachGetButton.blur();
  const report = coachReport;
  if (!report) return;
  const generation = coachGeneration;
  coachGetButton.disabled = true;
  coachGetButton.textContent = 'Asking the coach…';
  void requestCoaching(report).then((response) => {
    if (generation !== coachGeneration) return; // a new session started meanwhile
    // Retrying only helps if the call failed; without a key it would just fail again.
    const final = response.source === 'claude' || response.reason === 'no-key';
    coachGetButton.disabled = final;
    coachGetButton.textContent = response.source === 'claude' ? 'Got coaching' : response.reason === 'no-key' ? 'Claude coach off' : 'Try again';
    renderCoaching(response, [fallbackNote(response.reason), response.detail ? `API said: ${response.detail}` : ''].filter(Boolean).join(' '));
  });
});

coachSpeakInput.addEventListener('change', () => {
  coachSpeakInput.blur();
  if (!coachSpeakInput.checked) speaker.stop();
  else if (coachShown && !coachEl.hidden) speaker.speak(coachingSpeech(coachShown.coaching));
});

renderLessonPicker();
showLesson(selectedLesson());
updateLessonControls();

// Dev-server only: handles for poking at the app from the console or a browser test script.
// Vite strips this from production builds (import.meta.env.DEV is false there).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __drumly: {
      metronome,
      manager,
      TestSource,
      ALL_LESSONS,
      lessonToExpectedNotes,
      highwayView: () => highwayView,
      lessonRun: () => lessonRun,
      coachReport: () => coachReport,
      kit: () => kit,
      lessonSounds: () => lessonSounds,
      lastSession: () => lastSession,
      compareRun: () => compareRun,
      recordRun: () => recordRun,
      customStore,
      highway,
    },
  });
}
