import { MIN_BPM } from '../metronome/timing';
import type { Coaching, ProblemSpotReport, SessionReport } from './types';

/** Fill (or whole-lesson) mean offset beyond this many ms gets called out as rushing or dragging. */
export const RUSH_MS = 15;
/** Spread (std dev) above this many ms means the timing is too loose: slow down. */
export const LOOSE_SPREAD_MS = 25;
/** Spread at or below this is worth praising. */
export const STEADY_SPREAD_MS = 15;
/** How much to slow down for a loose session. */
export const SLOW_DOWN_BPM = 10;
const MAX_FIXES = 2;
const MAX_WINS = 3;
const SPOT_WORDS: Record<number, string> = { 2: 'Two', 3: 'Three' };

interface Fix {
  text: string;
  exercise: string;
}

/**
 * Coaching from simple rules, like a teacher's quick notes. Pure, works offline, and never says
 * anything the report's numbers don't show.
 */
export function ruleBasedCoaching(report: SessionReport): Coaching {
  const fixes = findFixes(report);
  const fixThis = fixes.slice(0, MAX_FIXES).map((f) => f.text);
  const learned = report.trainer?.learned === true;
  // Problem spots come first: never send the player on to the next lesson with a known bad note.
  const worst = report.problemSpots[0];
  return {
    headline: headline(report, fixThis.length),
    wentWell: wentWell(report).slice(0, MAX_WINS),
    fixThis,
    nextExercise: worst ? spotDrill(report, worst) : learned ? nextAfterLearning(report) : (fixes[0]?.exercise ?? keepGoing(report)),
  };
}

/** Everything worth fixing, most important first. */
function findFixes(r: SessionReport): Fix[] {
  const fixes: Fix[] = [];
  const lastBpm = lastPassBpm(r);
  const slowBpm = slowDownBpm(r);
  const part = r.fill ? `just ${r.fill.beats}` : 'just that beat';

  // Repeated wrong pad on one note: the hand is going to the wrong drum.
  const wrong = r.problemSpots.find((s) => s.wrongPad >= 2 && s.playedInstead !== null);
  if (wrong) {
    fixes.push({
      text: `${wrong.pad} on ${wrong.where} keeps landing on ${wrong.playedInstead}. Play ${part} slowly until your hand finds ${wrong.pad}.`,
      exercise: spotDrill(r, wrong),
    });
  }

  // Repeated miss.
  const missed = r.problemSpots.find((s) => s !== wrong && s.missed >= 2);
  if (missed) {
    fixes.push({
      text: `${missed.pad} on ${missed.where} keeps dropping out (missed in ${missed.missed} of ${missed.passes} passes). Slow down until every note sounds.`,
      exercise: spotDrill(r, missed),
    });
  }

  // Rushing or dragging the fill (or the whole lesson when there's no fill).
  const timing = r.fill ?? r.timing;
  const mean = timing.meanMs;
  if (mean !== null && Math.abs(mean) > RUSH_MS) {
    const rushing = mean < 0;
    if (r.fill) {
      const first = r.fill.firstPad.toLowerCase();
      fixes.push(rushing
        ? {
            text: `You're rushing into the fill (about ${-mean} ms early). Count '${r.fill.count}' out loud and land the first ${first} on time.`,
            exercise: `Play it at ${lastBpm} BPM counting '${r.fill.count}' out loud, until the fill sits on the click 5 passes in a row.`,
          }
        : {
            text: `You're dragging the fill (about ${mean} ms late). Count '${r.fill.count}' out loud and keep the fill moving with the click.`,
            exercise: `Play it at ${lastBpm} BPM counting '${r.fill.count}' out loud, until the fill sits on the click 5 passes in a row.`,
          });
    } else {
      fixes.push({
        text: rushing
          ? `You're rushing (about ${-mean} ms early on average). Relax and let the click come to you.`
          : `You're dragging (about ${mean} ms late on average). Lean into the click a little.`,
        exercise: `Play it at ${lastBpm} BPM and count out loud, until your hits sit on the click 5 passes in a row.`,
      });
    }
  }

  // Loose timing overall.
  const spread = r.timing.spreadMs;
  if (spread !== null && spread > LOOSE_SPREAD_MS) {
    fixes.push({
      text: `Your timing is loose (hits spread about ${spread} ms). Drop ${SLOW_DOWN_BPM} BPM to ${slowBpm} and try the "Count-in only" click mode.`,
      exercise: `Play 5 passes at ${slowBpm} BPM with the click on "Count-in only", then turn the click back on and check you're still with it.`,
    });
  }

  // A note that is repeatedly early or late (but on the right pad).
  const timingSpot = r.problemSpots.find((s) => s !== wrong && s !== missed && s.meanMs !== null && s.early + s.late >= 2);
  if (timingSpot) fixes.push(timingSpotFix(r, timingSpot));

  // Getting worse at a steady tempo usually means tired or tense.
  if (r.accuracy.trend === 'getting worse' && r.bpm.min === r.bpm.max) {
    fixes.push({
      text: `Accuracy dropped from ${r.accuracy.start}% to ${r.accuracy.end}% as you went. Shake out your hands and take a short break.`,
      exercise: `After a short break, play 3 relaxed passes at ${slowBpm} BPM before going back to ${lastBpm}.`,
    });
  }
  return fixes;
}

function timingSpotFix(r: SessionReport, s: ProblemSpotReport): Fix {
  const late = (s.meanMs ?? 0) > 0;
  const n = Math.abs(s.meanMs ?? 0);
  const count = late ? s.late : s.early;
  return {
    text: `${s.pad} on ${s.where} comes in ${late ? 'late' : 'early'} (${count} of ${s.passes} passes, about ${n} ms).`,
    exercise: spotDrill(r, s),
  };
}

function lastPassBpm(r: SessionReport): number {
  return r.accuracy.perPass.at(-1)?.bpm ?? r.bpm.max;
}

function slowDownBpm(r: SessionReport): number {
  return Math.max(MIN_BPM, lastPassBpm(r) - SLOW_DOWN_BPM);
}

/**
 * Drill one problem spot slowly: just the beats around it, until it's clean 3 times in a row.
 * E.g. "Loop just beats 3 and 4 of bar 2 at 55 BPM until Tom 2 is clean 3 times in a row, then try the full fill."
 */
export function spotDrill(r: SessionReport, s: ProblemSpotReport): string {
  let part: string;
  if (r.fill) {
    // Problem spots of a fill lesson are inside the fill or its landing (the next downbeat).
    part = s.bar === r.fill.bar ? `just ${r.fill.beats} of bar ${r.fill.bar}` : `${r.fill.beats} of bar ${r.fill.bar} into the 1 of bar ${s.bar}`;
  } else {
    part = `just bar ${s.bar}`;
  }
  const then = r.fill ? 'try the full fill' : `play the whole ${r.lesson.category}`;
  return `Loop ${part} at ${slowDownBpm(r)} BPM until ${s.pad} is clean 3 times in a row, then ${then}.`;
}

function wentWell(r: SessionReport): string[] {
  const wins: string[] = [];
  const acc = r.accuracy.overall;
  const what = r.graded === 'fill' ? 'the fill' : 'the lesson';
  // "Learned at N BPM" is the headline's job; saying it again here is just repetition.
  if (r.trainer && r.bpm.max > r.bpm.min) wins.push(`You climbed from ${r.bpm.min} to ${r.bpm.max} BPM.`);
  if (acc !== null && acc >= 90) wins.push(`Right drums, right place: ${acc}% on ${what}.`);
  if (r.accuracy.trend === 'improving') wins.push(`You got better as you went: ${r.accuracy.start}% to ${r.accuracy.end}%.`);
  const spread = r.timing.spreadMs;
  if (spread !== null && spread <= STEADY_SPREAD_MS && acc !== null && acc >= 50) wins.push(`Steady timing: your hits stayed within about ${spread} ms.`);
  if (r.fill && r.fill.tendency === 'on time' && r.fill.accuracy !== null && r.fill.accuracy >= 50) wins.push('You came out of the fill on time.');
  if (wins.length === 0) wins.push(`You put in ${r.passes} ${r.passes === 1 ? 'pass' : 'passes'}. Reps are how this sticks.`);
  return wins;
}

function headline(r: SessionReport, fixCount: number): string {
  const acc = r.accuracy.overall ?? 0;
  if (r.trainer?.learned) {
    const learned = `${r.lesson.category === 'fill' ? 'Fill' : 'Beat'} learned at ${r.trainer.finalBpm} BPM.`;
    const spots = r.problemSpots.length;
    if (spots === 0) return `${learned} Nice work.`;
    return `${learned} ${spots === 1 ? 'One spot' : `${SPOT_WORDS[spots] ?? spots} spots`} to clean up.`;
  }
  if (acc < 70) return "Tough one, but you're putting in the reps.";
  if (fixCount === 0) return acc >= 90 ? 'Clean session. Time to push the tempo.' : 'Good session.';
  return fixCount === 1 ? 'Good work. One thing to tighten up.' : 'Good work. Two things to tighten up.';
}

function nextAfterLearning(r: SessionReport): string {
  if (r.lesson.next) return `Move on to "${r.lesson.next}". Start it in the Trainer and let it bring you up to speed.`;
  const target = (r.trainer?.targetBpm ?? r.bpm.max) + 10;
  return `That's the hardest ${r.lesson.category} here. Run it in the Trainer again with the target at ${target} BPM.`;
}

function keepGoing(r: SessionReport): string {
  if (r.trainer) return `Run it in the Trainer again from ${r.trainer.finalBpm} BPM and push for ${r.trainer.targetBpm}.`;
  const acc = r.accuracy.overall ?? 0;
  if (acc >= 90) return `Turn on the Trainer and let it take you up from ${r.bpm.max} BPM.`;
  return `Loop it at ${r.bpm.max} BPM until you get 3 passes in a row over 90%.`;
}
