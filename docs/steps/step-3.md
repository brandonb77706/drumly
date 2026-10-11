# Next step: Step 3, the comparison engine

Read CLAUDE.md first. Steps 1 and 2 are done and reviewed (53 tests passing, typecheck clean).

## Goal
Given a list of expected notes and a list of played hits, decide for every note whether it was hit correctly, hit on the wrong pad, missed, or extra, and how many milliseconds early or late each hit was. This engine is the heart of the app: lessons, fills, songs, and coaching all reuse it.

Put it in `src/grading/`. Keep the core as pure functions with no DOM, audio, or clock access.

## Data types
- `ExpectedNote`: `{ id, pad, time }` where time is ms on the performance.now() clock. Optional `velocity` for accent checks later.
- Input hits: the existing `Hit` type from `src/input/types.ts`.
- Result per expected note: `{ note, status: 'hit' | 'wrongPad' | 'missed', hit?, offsetMs? }` (offsetMs = hit.time - note.time, negative = early).
- Extra hits: hits that didn't match any note, `{ hit, status: 'extra' }`.

## Matching rules
1. A hit can match a note only if it's within a matching window (default +/- 100 ms, configurable).
2. Prefer same-pad matches over wrong-pad matches. A wrong-pad hit only counts as `wrongPad` if no same-pad hit is available for that note inside the window.
3. Each hit matches at most one note and each note at most one hit.
4. Simultaneous notes (kick + hi-hat on the same beat) must each match their own hit. Don't let one hit steal another note's match.
5. When two hits compete for one note, the closer one wins and the other can still match a different note or become extra.
6. Use a deterministic algorithm (sort by time, then greedy by smallest offset per pad, then a second pass for wrong-pad). Explain the algorithm in a comment. No randomness.
7. Hi-hat variants: treat `hihatClosed` and `hihatOpen` as wrong pads for each other, but make pad equivalence configurable so later lessons can say "any hi-hat is fine". Same idea for `snare` vs `snareRim`.

## Timing grades
Add a pure function that labels each matched hit by offset:
- `perfect`: |offset| <= 20 ms
- `good`: <= 40 ms
- `early` / `late`: beyond 40 ms but inside the matching window
Thresholds must be configurable, since they'll be retuned when the real kit is back.

## Summary
A pure `summarize(results)` returning: accuracy % (hits / expected notes), counts per status, mean offset (shows rushing or dragging), standard deviation of offset (shows consistency), and per-pad breakdown of the same numbers.

## Live grading
Add a thin `LiveGrader` class that:
- Takes the InputManager and a list of expected notes (or a function giving expected notes from the metronome grid).
- Grades each hit as it arrives and emits a result event, so the UI can flash green, yellow, or red immediately.
- Marks a note `missed` only once its window has fully passed (check on a requestAnimationFrame or metronome tick, not setTimeout).
- On stop, returns the final results and summary. Live and batch grading of the same hits must give identical results; add a test proving it.

## Test page
- Add a "Grade test" mode to the existing page: the expected pattern is the 100 BPM rock beat from `src/patterns.ts`, starting on the metronome's bar 0 after a count-in.
- Show each hit's status and timing grade with color in the hit log.
- After 2 bars, show the summary (accuracy, mean offset, consistency, per-pad table).
- Add buttons that replay scripted runs through TestSource: a perfect run, a run that's consistently 30 ms late, a run with two missed snares and one extra kick, and a run with one hi-hat played as a ride. The summary must match what each script should produce.

## Unit tests (Vitest)
- Perfect run: 100% accuracy, all offsets 0.
- Consistently late by 30 ms: all `good`, mean offset +30, std dev ~0.
- Missed notes, extra hits, wrong pads each detected correctly.
- Simultaneous kick + hi-hat each match their own hit.
- A hit just outside the window becomes extra, and its note becomes missed.
- Two hits near one note: closer one matches, other is extra.
- Pad equivalence: with "any hi-hat" enabled, an open hi-hat matches a closed hi-hat note.
- Live grader and batch grader give identical results for the same hits.
- Summary math: mean, std dev, per-pad counts.

## Done means
Tests, typecheck, and build pass. Then append a `## Result` section to this file with what was built, test counts, and anything untested or uncertain.

## Result

**Status: done.** `npm test` passes all 95 tests in 10 files: the 53 from steps 1 and 2 plus 42 new ones. `npm run typecheck` is clean and `npm run build` succeeds.

### What was built
- `src/grading/match.ts` holds `grade(notes, hits, config)`, the pure, deterministic matcher. It runs two greedy passes over candidate pairs inside the window, globally closest first: same pad, then wrong pad. Unmatched notes are missed and unmatched hits are extra. The algorithm is explained in the comment above `grade`.
- `src/grading/types.ts` holds the config: `windowMs` (default 100), `timing` thresholds (default 20 and 40), and `equivalentPads` groups. The groups are empty by default, so closed and open hi-hat are wrong pads for each other. The `ANY_HIHAT` and `ANY_SNARE` presets loosen that per lesson.
- `src/grading/timingGrade.ts` holds `gradeTiming(offset, thresholds)`, which labels each offset perfect, good, early, or late.
- `src/grading/summary.ts` holds `summarize(result)`. It returns accuracy, status counts, mean offset, population std dev, timing counts, and the same numbers per pad.
- `src/grading/LiveGrader.ts` grades each hit as it arrives by re-running `grade()` over everything seen so far. It emits these events:
  - `hit` when a hit arrives, with its verdict.
  - `revised` when a later hit changes an earlier verdict.
  - `missed` once a note's window plus 50 ms grace has passed, checked on requestAnimationFrame.
  - `complete` when a fixed note list is finished.

  `stop()` returns `grade()` and `summarize()` over the same inputs. Expected notes can be a fixed list or a `(from, to) => notes` function, such as one built from the metronome grid.
- `src/gradeScenarios.ts` holds the exercise notes and the four scripted runs, each with its expected summary. The test page and the unit tests both use it.
- **Test page:** a "Grade test" panel runs the 100 BPM rock beat from bar 0 after a count-in. It has a "Grade me (keyboard)" button and four replay buttons.
  - The hit log has a Grade column with status, timing, and offset, colored green, yellow, or red. Revised verdicts update the row in place, and missed notes get their own rows.
  - Pad tiles flash the grade color.
  - The summary shows stat tiles and a per-pad table. Replay runs also show a ✓ or ✗ check against the scenario's expected summary.

### Decisions the reviewer should check
- **Mean offset and std dev use every matched note, wrongPad included.** Pad choice doesn't change timing. Accuracy still counts only `hit`.
- **Std dev divides by n, not n-1.**
- **Results come back in time order.** Ties are broken deterministically: the earlier note wins, then the earlier hit.
- **Window edges are inclusive.** A hit exactly 100 ms off still matches.
- **`stop()` grades only notes with time <= the stop time.** A lesson stopped early doesn't count future notes as missed.
- **Hits before bar 0 minus the window are ignored in the grade test.** That's the `ignoreHitsBefore` option, so tapping during the count-in isn't penalized.
- **Live verdicts can change.** A closer hit arriving later can take a note from an earlier hit, which is why `revised` exists. Only the final result from `stop()` is guaranteed to match batch grading. A test also checks that the last verdict the UI saw for each hit matches batch.

### Verified in a browser
Headless Chrome via the dev server, with the real metronome, Web Audio clock, and requestAnimationFrame:
- All four replay buttons passed their on-page summary check.

| Run | Accuracy | Missed | Extra | Wrong pad | Mean offset | Std dev |
|---|---|---|---|---|---|---|
| Perfect | 100% | 0 | 0 | 0 | 0.0 ms | 0.0 ms |
| 30 ms late | 100%, all "good" | 0 | 0 | 0 | +30.0 ms | 0.0 ms |
| 2 missed snares + extra kick | 91.7% | 2 | 1 | 0 | 0.0 ms | 0.0 ms |
| Hi-hat played as ride | 95.8% | 0 | 0 | 1 | 0.0 ms | 0.0 ms |

- "Grade me" with no input reported all 24 notes missed.

### Not tested, or uncertain
- **Real keyboard play by a person.** Headless Chrome has no real typing, sound, or visual check of the flashes and colors.
- **The MIDI kit.** It isn't available, so the timing thresholds haven't been tuned against real hits, as CLAUDE.md says.
- **Missed-note reporting in a background tab.** It relies on requestAnimationFrame, which pauses there. The final result from `stop()` is unaffected.
- **Live regrading cost on long songs.** It re-runs the batch grader on every hit, which is fine for lessons of a few hundred notes. For full songs in step 8, it should only regrade notes near the new hit.
- **A late MIDI hit could arrive after its note was already reported missed.** That needs a hit timestamped inside the window but delivered more than 50 ms after the window closed. The final result would still be correct, but the UI would have shown a miss first. Retune `missGraceMs` with the kit.
- **No commits were made.** The repo has no commits yet, and none were requested.
