import { barChart, lineChart, type ChartBox } from '../history/chart';
import { dailyMinutes, lessonSeries, lessonSummaries, personalBests, practiceStreak, weekSummary, type LessonSummary, type TrendArrow } from '../history/stats';
import type { SessionMode, SessionRecord } from '../history/types';
import { node } from './summary';
import { formatDuration, formatPctShort } from './format';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

const MODE_LABELS: Record<SessionMode, string> = { practice: 'Practice', trainer: 'Trainer', listen: 'Listen, then play', record: 'Record' };
const TREND_TEXT: Record<TrendArrow, { arrow: string; title: string }> = {
  up: { arrow: '↑', title: 'Improving' },
  down: { arrow: '↓', title: 'Slipping lately' },
  flat: { arrow: '→', title: 'Steady' },
};

function formatDate(ms: number, withTime = false): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return withTime ? `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date;
}

function bpmText(v: number): string {
  return String(Number(v.toFixed(1)));
}

function tile(label: string, value: string, note = ''): HTMLElement {
  return node('div', 'stat', undefined, [node('div', 'label', label), node('div', 'value', value), node('div', 'note', note)]);
}

/** Week totals, streak, and minutes per day for the last 7 days. */
export function renderOverview(container: HTMLElement, sessions: readonly SessionRecord[], now: number): void {
  const week = weekSummary(sessions, now);
  const streak = practiceStreak(sessions, now);
  const stats = node('div', 'summary-stats', undefined, [
    tile('Practice this week', formatDuration(week.minutes * 60_000), 'last 7 days'),
    tile('Day streak', String(streak), streak === 0 ? 'play today to start one' : streak === 1 ? 'day in a row' : 'days in a row'),
    tile('Sessions this week', String(week.sessions)),
  ]);
  container.replaceChildren(stats, weekChart(dailyMinutes(sessions, now)));
}

function weekChart(days: ReturnType<typeof dailyMinutes>): HTMLElement {
  // Wide viewBox: the chart spans the page, and text keeps a normal size.
  const box: ChartBox = { width: 1040, height: 190, left: 40, right: 10, top: 22, bottom: 28 };
  const { bars, yTicks } = barChart(days.map((d) => d.minutes), box, { minMax: 10, gap: 60 });
  const root = svg('svg', { viewBox: `0 0 ${box.width} ${box.height}`, class: 'chart', role: 'img', 'aria-label': 'Minutes practiced per day, last 7 days' });
  for (const t of yTicks) {
    root.append(svg('line', { x1: box.left, x2: box.width - box.right, y1: t.y, y2: t.y, class: 'grid' }));
    root.append(svg('text', { x: box.left - 6, y: t.y + 4, class: 'axis', 'text-anchor': 'end' }, String(t.value)));
  }
  bars.forEach((b, i) => {
    const day = days[i]!;
    const rect = svg('rect', { x: b.x, y: b.y, width: b.width, height: Math.max(b.value > 0 ? 2 : 0, b.height), rx: 3, class: i === days.length - 1 ? 'bar today' : 'bar' });
    rect.append(svg('title', {}, `${day.label} ${formatDate(day.start)}: ${formatDuration(day.minutes * 60_000)}`));
    root.append(rect);
    if (b.value > 0) root.append(svg('text', { x: b.x + b.width / 2, y: b.y - 5, class: 'value', 'text-anchor': 'middle' }, String(Math.round(b.value))));
    root.append(svg('text', { x: b.x + b.width / 2, y: box.height - 8, class: 'axis', 'text-anchor': 'middle' }, i === days.length - 1 ? 'Today' : day.label));
  });
  return node('figure', 'chart-figure', undefined, [node('figcaption', '', 'Minutes per day'), root as unknown as HTMLElement]);
}

function bestCell(row: LessonSummary): string {
  if (row.bests.accuracy) return formatPctShort(row.bests.accuracy.value);
  if (row.bestAnyTempo) return `${formatPctShort(row.bestAnyTempo.value)} at ${bpmText(row.bestAnyTempo.bpm)} BPM`;
  return '—';
}

/** Every lesson played: best accuracy, fastest clean tempo, last played, trend. A row opens its detail view. */
export function renderLessonList(container: HTMLElement, sessions: readonly SessionRecord[], onOpen: (lessonId: string) => void): void {
  const rows = lessonSummaries(sessions);
  if (rows.length === 0) {
    container.replaceChildren(node('p', 'hint', 'No lessons played yet. Finish a pass in Practice and it shows up here.'));
    return;
  }
  const header = node('tr', '', undefined, ['Lesson', 'Best accuracy', 'Fastest clean', 'Last played', 'Trend'].map((h, i) => node('th', i === 0 ? '' : 'num', h)));
  const body = rows.map((row) => {
    const trend = row.trend ? TREND_TEXT[row.trend] : null;
    const trendCell = node('td', `num trend ${row.trend ?? ''}`, trend?.arrow ?? '—');
    trendCell.title = trend?.title ?? 'Play it again to see a trend';
    const open = node('button', 'link', row.title);
    open.type = 'button';
    open.addEventListener('click', () => {
      open.blur();
      onOpen(row.lessonId);
    });
    const tr = node('tr', '', undefined, [
      node('td', '', undefined, [open, node('span', 'hint', ` · ${row.sessions} session${row.sessions === 1 ? '' : 's'}`)]),
      node('td', 'num', bestCell(row)),
      node('td', 'num', row.bests.cleanBpm ? `${bpmText(row.bests.cleanBpm.value)} BPM` : '—'),
      node('td', 'num', formatDate(row.lastPlayed)),
      trendCell,
    ]);
    tr.dataset.lesson = row.lessonId;
    return tr;
  });
  container.replaceChildren(node('div', 'table-scroll', undefined, [node('table', 'progress-table', undefined, [node('thead', '', undefined, [header]), node('tbody', '', undefined, body)])]));
}

export interface DetailHandlers {
  onBack: () => void;
  /** Called from the click: it may start audio. */
  onReplay: (session: SessionRecord) => void;
}

/** One lesson: accuracy and fastest clean tempo over time, the latest problem spots, and every session. */
export function renderLessonDetail(container: HTMLElement, lessonId: string, allSessions: readonly SessionRecord[], handlers: DetailHandlers): void {
  const sessions = allSessions.filter((s) => s.lessonId === lessonId && s.passes.length > 0).sort((a, b) => b.startedAt - a.startedAt);
  const back = node('button', 'back', '← All lessons');
  back.type = 'button';
  back.addEventListener('click', () => {
    back.blur();
    handlers.onBack();
  });
  if (sessions.length === 0) {
    container.replaceChildren(back, node('p', 'hint', 'No sessions for this lesson.'));
    return;
  }
  const latest = sessions[0]!;
  const bests = personalBests(sessions);
  const series = lessonSeries(sessions);
  const best = sessions.filter((s) => s.bestPass).reduce<SessionRecord | null>((top, s) => {
    const acc = s.passes[s.bestPass!.pass]?.focusAccuracy ?? -1;
    const topAcc = top ? (top.passes[top.bestPass!.pass]?.focusAccuracy ?? -1) : -2;
    return acc > topAcc || (acc === topAcc && top && s.bestPass!.bpm > top.bestPass!.bpm) ? s : top;
  }, null);

  const head = node('div', 'detail-head', undefined, [
    back,
    node('h3', '', latest.lessonTitle),
    node('span', 'hint', `${sessions.length} session${sessions.length === 1 ? '' : 's'} · default ${bpmText(latest.defaultBpm)} BPM`),
  ]);
  const tiles = node('div', 'summary-stats', undefined, [
    tile('Best accuracy', bests.accuracy ? formatPctShort(bests.accuracy.value) : '—', bests.accuracy ? `at ${bpmText(bests.accuracy.bpm)} BPM, ${formatDate(bests.accuracy.at)}` : `at ${bpmText(latest.defaultBpm)} BPM or faster`),
    tile('Fastest clean pass', bests.cleanBpm ? `${bpmText(bests.cleanBpm.value)} BPM` : '—', bests.cleanBpm ? formatDate(bests.cleanBpm.at) : 'no clean pass yet'),
  ]);
  const replayBest = node('button', 'primary', 'Replay best pass');
  replayBest.type = 'button';
  replayBest.disabled = best === null;
  if (best) {
    replayBest.title = `Pass from ${formatDate(best.startedAt, true)}: the correct version, then yours`;
    replayBest.addEventListener('click', () => {
      replayBest.blur();
      handlers.onReplay(best);
    });
  }

  const charts = node('div', 'chart-row', undefined, [
    lineFigure('Accuracy per session (best pass)', series.accuracy.map((p) => p.value), series.accuracy.map((p) => p.at), { yMin: 0, yMax: 100, unit: '%' }),
    lineFigure('Fastest clean tempo per session', series.cleanBpm.map((p) => p.value), series.cleanBpm.map((p) => p.at), { unit: ' BPM', empty: 'No clean passes yet. A pass at or above the clean threshold shows up here.' }),
  ]);

  const withSpots = sessions.find((s) => (s.report?.problemSpots.length ?? 0) > 0);
  const spots = withSpots
    ? node('div', 'problem-spots', undefined, [
        node('h3', '', `Latest problem spots (${formatDate(withSpots.startedAt)})`),
        node('ol', '', undefined, withSpots.report!.problemSpots.map((p) => {
          const timing = p.meanMs === null ? '' : p.meanMs < -10 ? `, ${-p.meanMs} ms early` : p.meanMs > 10 ? `, ${p.meanMs} ms late` : '';
          const instead = p.playedInstead ? `, often ${p.playedInstead} instead` : '';
          return node('li', '', `${p.pad} on ${p.where}: off in ${p.offPasses} of ${p.passes} passes${instead}${timing}`);
        })),
      ])
    : node('p', 'hint', 'No problem spots recorded for this lesson.');

  container.replaceChildren(head, tiles, replayBest, charts, spots, sessionTable(sessions, handlers));
}

function lineFigure(title: string, values: (number | null)[], times: number[], options: { yMin?: number; yMax?: number; unit: string; empty?: string }): HTMLElement {
  const box: ChartBox = { width: 520, height: 200, left: 44, right: 14, top: 14, bottom: 28 };
  const figure = node('figure', 'chart-figure', undefined, [node('figcaption', '', title)]);
  if (!values.some((v) => v !== null)) {
    figure.append(node('p', 'hint chart-empty', options.empty ?? 'Nothing to chart yet.'));
    return figure;
  }
  const c = lineChart(values, box, { ...(options.yMin !== undefined ? { yMin: options.yMin } : {}), ...(options.yMax !== undefined ? { yMax: options.yMax } : {}) });
  const root = svg('svg', { viewBox: `0 0 ${box.width} ${box.height}`, class: 'chart', role: 'img', 'aria-label': title });
  for (const t of c.yTicks) {
    root.append(svg('line', { x1: box.left, x2: box.width - box.right, y1: t.y, y2: t.y, class: 'grid' }));
    root.append(svg('text', { x: box.left - 6, y: t.y + 4, class: 'axis', 'text-anchor': 'end' }, String(t.value)));
  }
  root.append(svg('path', { d: c.path, class: 'line' }));
  for (const p of c.points) {
    const dot = svg('circle', { cx: p.x, cy: p.y, r: 4, class: 'dot' });
    dot.append(svg('title', {}, `${formatDate(times[p.index]!, true)}: ${bpmText(p.value)}${options.unit}`));
    root.append(dot);
  }
  // Dates under the first and last session (and the middle one when there's room).
  const labelled = values.length <= 2 ? values.map((_, i) => i) : [0, Math.floor((values.length - 1) / 2), values.length - 1];
  for (const i of [...new Set(labelled)]) {
    const anchor = values.length === 1 ? 'middle' : i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle';
    root.append(svg('text', { x: c.xs[i]!, y: box.height - 8, class: 'axis', 'text-anchor': anchor }, formatDate(times[i]!)));
  }
  figure.append(root as unknown as HTMLElement);
  return figure;
}

function sessionTable(sessions: readonly SessionRecord[], handlers: DetailHandlers): HTMLElement {
  const header = node('tr', '', undefined, ['Date', 'Mode', 'Passes', 'Best', 'Fastest clean', 'Time', ''].map((h, i) => node('th', i <= 1 ? '' : 'num', h)));
  const rows = sessions.map((s) => {
    const accs = s.passes.map((p) => p.focusAccuracy).filter((v): v is number => v !== null);
    const clean = s.passes.filter((p) => p.clean).map((p) => p.bpm);
    const replay = node('button', 'link', 'Replay best');
    replay.type = 'button';
    replay.disabled = !s.bestPass;
    replay.addEventListener('click', () => {
      replay.blur();
      handlers.onReplay(s);
    });
    const mode = MODE_LABELS[s.mode] + (s.trainer?.learned ? ' · learned' : '') + (s.source === 'midi' ? ' · kit' : '');
    return node('tr', '', undefined, [
      node('td', '', formatDate(s.startedAt, true)),
      node('td', '', mode),
      node('td', 'num', String(s.passes.length)),
      node('td', 'num', accs.length > 0 ? formatPctShort(Math.max(...accs)) : '—'),
      node('td', 'num', clean.length > 0 ? `${bpmText(Math.max(...clean))} BPM` : '—'),
      node('td', 'num', formatDuration(s.playMs)),
      node('td', 'num', undefined, [replay]),
    ]);
  });
  return node('div', 'table-scroll session-list', undefined, [
    node('h3', '', 'Sessions'),
    node('table', 'progress-table', undefined, [node('thead', '', undefined, [header]), node('tbody', '', undefined, rows)]),
  ]);
}
