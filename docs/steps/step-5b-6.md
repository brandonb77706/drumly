# Next step: 5b (highway polish), then Step 6 (fill trainer)

Read CLAUDE.md first. Step 5 was reviewed: 178 tests, typecheck, and build pass, and the reviewer looked at `docs/steps/step-5-highway.png`. The previous step file is archived in `docs/steps/step-5.md`. Your "Around the toms" reading (groove in bar 1, fill on beats 3 and 4 of bar 2) is correct.

Do part A first, then part B.

## Part A: Step 5b, fixes from the screenshot review

1. **Look-back is too short (you flagged it, confirmed in the screenshot).** The now line sits at about 17% of the canvas, so a just-graded note disappears almost immediately. Move the now line to about 35% of the lane width and show about 1.5 s ahead instead of 2 s. Players need to glance back at the fill they just played. Keep it configurable in the layout object and update the `noteToX` tests.
2. **Wrong-pad hits are drawn in the wrong lane.** The hit tick for a wrong-pad hit is drawn in the note's lane (Tom 2), but the player hit Tom 3. Keep the orange note in Tom 2, and draw the hit tick in the lane of the pad actually played (Tom 3), so the player sees where they went. If that pad has no lane, draw it in "other".
3. **Status text says "perfect -0.0".** Format offsets as whole ms with a sign: "+12 ms", "-8 ms", "0 ms", never "-0.0". For wrong-pad hits, say "on time" or "12 ms late" instead of "perfect", since "perfect" next to "wrong pad" reads as a contradiction. Add a unit-tested `formatOffset` helper.
4. **Stop button is unreadable.** Orange text on an orange background. Use dark text on the filled button and check the contrast of every button state (normal, hover, disabled).
5. **"other" lane is clipped** at the bottom of the canvas. Give it the same height as the other lanes, and only show it when an extra hit actually lands on a pad that has no lane.
6. **Lesson description vs. layout.** The "Around the toms" description says "One bar of beat, then 16ths on beats 3 and 4". Change it to "One bar of groove, then a bar with the fill on beats 3 and 4, landing on crash plus kick in bar 3", so it matches what's on the highway.

## Part B: Step 6, the fill trainer

### Goal
Learn a fill the way a drum teacher would teach it: start slow, loop it, speed up only once it's clean, and know exactly which notes in the fill are the problem.

### Tempo ladder (auto speed-up)
- New "Trainer" mode for any lesson (fills especially). Settings: start BPM (default 60% of the lesson's BPM), target BPM (default the lesson's BPM), step size (default +5 BPM), pass threshold (default 90% accuracy), and passes needed (default 2 clean passes in a row).
- The trainer loops the lesson. After each pass it decides: pass meets the threshold → count it; enough clean passes in a row → raise BPM by the step, never above the target; below 70% accuracy twice in a row → drop BPM by one step (never below start BPM).
- Show the current BPM, the ladder progress (for example "75 → 85 BPM, 1 of 2 clean passes"), and a short message on each change ("Clean! Speeding up to 80 BPM", "Slowing down to 70 BPM").
- Reaching the target BPM with the required clean passes ends the session with a "Fill learned at 85 BPM" message.
- The ladder's decision logic must be a pure function: `nextLadderState(state, passSummary, settings)`. Unit test it fully. BPM changes must take effect at a pass boundary (the next loop start), using the metronome's existing commit-at-beat logic so nothing double clicks.

### Grade only the fill
- Lessons get an optional `focus` range (start and end position, for example bar 2 beat 3 to bar 3 beat 1). The groove before it is still played and shown, but accuracy for the ladder and the summary's headline number only count notes inside the focus range. The full-lesson stats stay available below.
- Shade the focus range on the highway so the player sees which part is being graded.
- Set focus ranges on both existing fills.

### Problem spots
- Across all passes in a trainer session, track each note in the focus range: how often it was missed, wrong pad, early, or late, and its average offset.
- After the session (or on demand), show the 3 worst notes with plain-language labels like "Tom 2 on the 'e' of beat 4: late in 4 of 6 passes, about 35 ms late on average" and "Snare on beat 3: hit as Tom 1 twice".
- Name subdivisions in drummer counting: beat number, "e", "and", "a" for 16ths; "trip" and "let" for triplets. Write a pure unit-tested `positionLabel(bar, beat, subdivision, subdivisionsPerBeat)` helper.
- Highlight those notes on the highway with a ring during the next pass.

### More fills
Add 4 more so there's a ladder of difficulty, each with a focus range:
1. "8th-note snare fill": beat 4 as two 8th snares, landing on crash plus kick. (Easiest)
2. "Snare to floor tom": 16ths on beat 4: snare, snare, tom3, tom3.
3. "Triplet fill": beat 4 as a triplet on snare, tom1, tom2, landing on crash plus kick (lesson uses a triplet grid).
4. "Full-bar tom run": a whole bar of 16ths moving snare (4), tom1 (4), tom2 (4), tom3 (4), landing on crash plus kick.
Sort fills in the picker from easiest to hardest.

### Unit tests
- Ladder: speeds up after the required clean passes, never exceeds target, slows down after two bad passes, never goes below start, finishes at target.
- Focus range: only notes inside it count toward headline accuracy; notes outside it are still graded and shown.
- Problem spots: correct counts and averages across passes, worst 3 ranked correctly, ties deterministic.
- `positionLabel`: beats, "e", "and", "a", triplet labels.
- Each new fill parses, has the right note count, and grades 100% on a scripted perfect run.
- A scripted trainer session: 2 perfect passes at 60 BPM moves to 65, then a run with one tom consistently late shows that tom as the top problem spot.

## Done means
Tests, typecheck, and build pass. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome. Save a screenshot of the trainer mid-session with the focus range shaded and a problem-spot ring visible as `docs/steps/step-6-trainer.png`. Then append a `## Result` section to this file covering both parts.

## Result

### Part A: 5b fixes
1. **Look-back.** `computeLayout` now puts the now line at `nowFraction` (default 0.35) of the lane area, measured right of the labels, and shows `futureMs` (default 1500) ahead. Both are options on the layout. At 1032 px that's about 0.75 s of look-back instead of about 0.5 s. The `noteToX` and layout tests are updated, and there's a new configurability test. In the browser the drawn now line sits at 423.5 px against 423.6 expected.
2. **Wrong-pad ticks** are drawn in the lane of the pad actually played, or in "other" if that pad has no lane. The note stays orange in its own lane. In the browser, a Tom 2 note hit on Tom 3 put its tick in the Tom 3 lane.
3. **Offsets.** New `src/ui/format.ts` is unit-tested.
   - `formatOffset` gives "+12 ms", "-8 ms" and "0 ms", never "-0".
   - `formatTimingPhrase` gives "on time" within the perfect threshold, otherwise "12 ms late" or "8 ms early". Wrong-pad feedback now reads "Tom 3: wrong pad (wanted Tom 2) · on time".
   - Summary stats no longer show "-0.0".
4. **Buttons.** Every state has explicit colors. Disabled no longer uses opacity.
   - The filled Start button has dark text on orange (8.0:1, hover 9.6:1).
   - Stop is filled red with dark text (6.8:1, hover 8.1:1).
   - Outline buttons are 7.4:1, hover 6.4:1.
   - Disabled is muted gray (5.6:1).
   - In the browser, hovering Stop gave dark text on #ff8787.
5. **The "other" lane** is hidden until a hit lands on a pad with no lane, then it's a full-height lane. The canvas grows from 250 to 284 px.
6. **The "Around the toms" description** is reworded as requested.

### Part B: Step 6, the fill trainer
- **Tempo ladder** in `src/trainer/ladder.ts`. `nextLadderState` is pure.
  - It speeds up after N clean passes in a row, capped at the target, and finishes at the target.
  - It slows down after 2 passes in a row below 70%, never below the start BPM.
  - A pass between 70% and the threshold breaks both streaks.
  - Defaults: 60% of the lesson BPM (rounded), the lesson BPM as target, +5, 90%, 2 passes.
- **BPM change at the pass boundary.** `ClickScheduler.updateAtBar` and `Metronome.setBpmAtBar` book a change for a bar's downbeat. It commits through the existing beat-boundary code, and `peek`/`getGrid` include it, so the grader and highway see the new tempo in advance.
  - One deliberate difference from `update()`: the gap *into* that downbeat keeps the old tempo, so the old pass is played entirely at its tempo and the new tempo starts exactly on the 1.
  - The trainer books the first pass start whose downbeat isn't scheduled yet.
  - If a decision ever misses the next pass, that pass is played at the old tempo. It is shown but not counted on the ladder ("not counted").
- **Focus ranges.** `Lesson.focus` holds start and end positions, inclusive, and is validated when a lesson is built. `focusResult` keeps the focus notes plus extra hits near them in the same pass.
  - The summary headline is now "Pass N: X% on the fill". The whole-lesson stats are in a "Whole lesson, groove included" fold below.
  - The highway shades each pass's focus range and labels it "graded".
  - All 6 fills have focus ranges, each running from the fill's first beat through the landing.
- **Problem spots.** `ProblemTracker` keeps per-note counts of missed, wrong pad (and which pads were played instead), early and late, plus the average offset.
  - The worst 3 are scored by misses + wrong pads + 0.5 × early/late. Ties go to the larger average offset, then to lesson order.
  - Each is described in drummer counting via `positionLabel`, e.g. "Tom 2 on the 'e' of beat 4 (bar 2): late in 4 of 6 passes, about 23 ms late on average".
  - The list shows on demand ("Show problem spots" in the trainer bar) and at the end of the session.
  - The worst notes get a pink ring on the highway while still to be played.
- **Fills**, sorted easiest to hardest: 8th-note snare fill (25 notes), Snare 16ths fill (27), Snare to floor tom (27), Triplet fill (19, triplet grid with a quarter-note groove), Around the toms (28), Full-bar tom run (30).
- **UI.** A "Trainer" checkbox shows the settings row. While the trainer runs, the BPM and speed controls are locked (the ladder owns the tempo) and Loop is implied. A status bar shows the current BPM, the progress ("65 → 70 BPM, 1 of 2 clean passes") and each change message.

### Tests
234 pass, up from 178. Typecheck and build pass. New or updated:
- Layout: the now-line position, look-ahead, configurable options, and the "other" lane.
- Model: wrong-pad tick lanes, the other lane appearing, focus regions (including moving with the grid), and highlights.
- `formatOffset`, `formatTimingPhrase` and `formatMsStat`.
- Focus ranges: inclusive ends, headline vs. full accuracy, extras by pass, and validation errors.
- `positionLabel` for beats, e/and/a, 8th "and", and trip/let.
- The ladder: 11 cases covering everything listed in the step.
- Problem spots: counts, averages, wording for wrong pads and misses, worst-3 ranking, and deterministic ties.
- `updateAtBar`: the exact downbeat time, booking just before the downbeat, refusing a bar already played, `peek` agreeing with what is scheduled, and no double clicks through `Metronome`.
- Every fill parses with the right counts, focus and pads, and a scripted perfect run grades 100%.
- **Scripted trainer session** on the real scheduler: 2 perfect passes at 60 BPM, then pass 2 is played at 65 BPM with notes spaced for 65. The late Tom 2 'e' becomes the top problem spot. A separate test checks that a stale-tempo pass is not counted.

### Checked in headless Chromium
My own Playwright Chromium with `--mute-audio` and DPR 2, not your Chrome.
- **All Part A items above.**
- **A full trainer session on Around the toms**, start 60 and target 70, with hits scripted on the live grid each pass:

  | Pass | Played at | Hits | Result |
  |---|---|---|---|
  | 1 | 60 BPM | perfect | 100%, 1 of 2 clean |
  | 2 | 60 BPM | perfect | 100%, speeds up to 65 |
  | 3 | 65 BPM | Tom 2 'e' +35 ms | 100%, 1 of 2 clean |
  | 4 | 65 BPM | Tom 2 'e' +35 ms | 100%, speeds up to 70 |
  | 5 | 70 BPM | Tom 2 'e' +35 ms | 100%, 1 of 2 clean |
  | 6 | 70 BPM | Tom 2 'e' +35 ms | "Fill learned at 70 BPM" |

  - Every tempo change landed on the very next pass.
  - 278 clicks were recorded with 0 doubles and 0 index gaps.
  - At bar 6 the interval into the downbeat was 250 ms (the old 16th) and 230.77 ms after it (the new 16th). Bar 12 went from 230.77 to 214.29 ms.
  - The final problem spot read "Tom 2 on the 'e' of beat 4 (bar 2): late in 4 of 6 passes, about 23 ms late on average".
  - There were no console errors.
- **Screenshot:** `docs/steps/step-6-trainer.png`, taken mid-session at 65 BPM. It shows the shaded focus range, the ringed Tom 2, the ladder status and the problem-spots list.
- **Bug found and fixed:** the on-demand "Show problem spots" button was inside the hidden problem-spots panel, so it could never be clicked. It now sits in the trainer status bar.

### Untested or uncertain
- **The slow-down path is tested only in unit tests,** not in the browser. The browser session only climbed.
- **Problem spots count a hit more than 20 ms off as early or late,** using the perfect threshold. That's stricter than the grade's 40 ms "good" threshold, so a consistently "good but 35 ms late" note shows up as a problem while the ladder still counts the pass as clean, as seen above. This seemed right for teaching, but tune it with the kit.
- **The trainer's tempo is set by the ladder, so the 50/75% speed control is disabled during a trainer session.**
- **The status line still says "Count-in… then play." during runs.** That's existing behavior.
- **Not tested here:** real playing, the sound itself, and the kit (not before about Oct 25). The 70% slow-down threshold and the 90% clean threshold are untuned.
- **Nothing is committed.**
