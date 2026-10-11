import { PAD_LABELS, type Pad } from '../input';
import type { GradeStats, GradeSummary } from '../grading';
import { formatMeanOffset, formatSpread } from './format';

export { PAD_LABELS };

export function fmtPct(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(1)}%`;
}

export function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, children: Node[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  e.append(...children);
  return e;
}

function stat(label: string, value: string, note = ''): HTMLElement {
  return node('div', 'stat', undefined, [node('div', 'label', label), node('div', 'value', value), node('div', 'note', note)]);
}

function tendency(mean: number | null): string {
  if (mean === null) return '';
  if (mean < -5) return 'rushing';
  if (mean > 5) return 'dragging';
  return 'on time';
}

/** Stat tiles plus a per-pad table for a grade summary. */
export function buildSummary(s: GradeSummary): HTMLElement[] {
  const t = s.timing;
  const stats = node('div', 'summary-stats', undefined, [
    stat('Accuracy', fmtPct(s.accuracy), `${s.hit} of ${s.expected} notes`),
    stat('Wrong pad', String(s.wrongPad)),
    stat('Missed', String(s.missed)),
    stat('Extra', String(s.extra)),
    stat('Mean offset', formatMeanOffset(s.meanOffsetMs), tendency(s.meanOffsetMs)),
    stat('Consistency', formatSpread(s.stdDevOffsetMs), 'std dev, lower is steadier'),
    stat('Timing', `${t.perfect} / ${t.good}`, `perfect / good · ${t.early} early · ${t.late} late`),
  ]);

  const header = node('tr', '', undefined,
    ['Pad', 'Expected', 'Hit', 'Wrong pad', 'Missed', 'Extra', 'Accuracy', 'Mean', 'Std dev'].map((h, i) => node('th', i === 0 ? '' : 'num', h)));
  const rows = (Object.entries(s.perPad) as [Pad, GradeStats][]).map(([pad, p]) =>
    node('tr', '', undefined, [
      node('td', '', PAD_LABELS[pad]),
      ...[String(p.expected), String(p.hit), String(p.wrongPad), String(p.missed), String(p.extra), fmtPct(p.accuracy), formatMeanOffset(p.meanOffsetMs),
        formatSpread(p.stdDevOffsetMs)].map((v) => node('td', 'num', v)),
    ]));
  const table = node('div', 'table-scroll', undefined, [
    node('table', '', undefined, [node('thead', '', undefined, [header]), node('tbody', '', undefined, rows)]),
  ]);
  return [stats, table];
}
