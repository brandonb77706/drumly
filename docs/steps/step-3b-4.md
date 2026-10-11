# Next step: 3b (grading fix), then Step 4 (first lessons)

Read CLAUDE.md first. Step 3 was reviewed: 95 tests, typecheck, and build all pass, and the design is good. The previous step file and its Result are archived in `docs/steps/step-3.md`.

Do part A first and get it passing before starting part B.

## Part A: Step 3b, fix out-of-order matching in `src/grading/match.ts`

### The bug
The greedy "closest pair first" pass can match same-pad notes out of order. In fast patterns, where same-pad notes are closer together than twice the window, this turns a consistently late player into misses plus extras.

Reproduction (fails today):
- Notes: snare at 0 ms and snare at 100 ms (16ths at 150 BPM).
- Hits: snare at 55 ms and snare at 160 ms (player about 55 to 60 ms late on both).
- Expected: both notes `hit` (late), no extras.
- Actual: note at 0 is `missed`, hit at 55 matches the note at 100, hit at 160 is `extra`.

Greedy grabs the 45 ms pair (note 100, hit 55) first, which crosses over the earlier note and strands both remaining items. This will happen constantly with 16th-note fills.

### Why it matters
Players are usually consistently early or late. The engine must never let one hit "jump" past another note on the same pad. Matches on the same pad must preserve time order: if note A is before note B, A's hit must be before B's hit.

### The fix
Replace the same-pad greedy pass with an order-preserving optimal alignment, run separately per pad group (pads joined by `equivalentPads` count as one group):
- Dynamic programming like sequence alignment (similar to edit distance). For each group, align its sorted notes with its sorted hits.
- A note and a hit can pair only if |offset| <= windowMs. Pairing costs the offset distance. Leaving a note unmatched or a hit unmatched costs a penalty larger than the window (for example windowMs + 1), so the algorithm always prefers matching when it can.
- Minimize total cost. This maximizes the number of matches first, then minimizes total timing error, and never crosses.
- Ties must stay deterministic (prefer the earlier note, then the earlier hit).
- Cost is O(notes x hits) per group. That's fine for lessons. Keep the band limited to pairs inside the window so long songs in step 8 stay fast.

Keep the wrong-pad pass as it is: it runs on whatever notes and hits are left after all same-pad alignments. Update the algorithm comment at the top of `grade()` to describe the new approach and why greedy was replaced.

### Tests to add
- The reproduction above: both notes `hit`, offsets +55 and +60, no extras.
- Consistently early version: notes 0 and 100, hits at -55 and 40. Both `hit`.
- 16th-note run of 8 snares at 100 ms spacing, every hit 55 ms late: 8 `hit`, 0 extras.
- Same run with one hit removed in the middle: exactly one `missed`, 0 extras, and the notes on both sides still matched to their own hits.
- Order preservation property: for random note and hit sets on one pad, matched hits are always in the same order as their notes. Use a seeded generator so it's deterministic.
- All existing grading tests and the live-versus-batch equivalence test still pass unchanged.

## Part B: Step 4, first lessons graded live

### Goal
Turn the test page from a debug tool into the first real practice screen: pick a lesson, play it along with the metronome, and get graded.

### Lesson format
Create `src/lessons/` with a `Lesson` type, defined in musical terms (not milliseconds) so it works at any tempo:
- `id`, `title`, `description`, `defaultBpm`, `beatsPerBar`, `bars`
- `subdivision` for the grid the lesson uses
- `notes`: a list of `{ pad, bar, beat, subdivision }` positions (0-based, matching the metronome's numbering)
- optional `equivalentPads` for that lesson (for example "any hi-hat is fine" for beginner beats)

Write a pure function `lessonToExpectedNotes(lesson, clickTimes)` that turns positions into `ExpectedNote` times using the metronome's actual scheduled click times, not by recomputing from BPM. This keeps the grading grid identical to what the player hears. Unit test it, including a lesson with 16ths.

Add a simple text format for writing lessons quickly, one line per pad, like:
```
HH: x-x-x-x-x-x-x-x-
SN: ----x-------x---
KK: x-------x-------
```
Each character is one subdivision step. Write a pure parser for it with tests (wrong line lengths and unknown pad names must throw clear errors).

### Starter lessons
1. Quarter-note rock beat: hi-hat quarters, kick 1 and 3, snare 2 and 4.
2. 8th-note rock beat: hi-hat 8ths, kick 1 and 3, snare 2 and 4.
3. Kick variation: 8th-note beat with kick on 1, the "and" of 2, and 3.
4. 16th-note hi-hat beat: hi-hat 16ths, kick 1 and 3, snare 2 and 4.
Each is 2 bars, with a sensible default BPM (slower for the 16th lesson).

### Practice flow
- Lesson picker on the page.
- Start plays a 1-bar count-in, then the lesson. Grading uses the step 3 LiveGrader.
- Loop mode: repeat the lesson continuously, grading each pass separately.
- After each pass, show the summary from step 3 plus the pass number.
- Track the best accuracy per lesson for the current page session only (saving comes in step 9).
- Keep all existing debug features, but move them under a collapsed "Debug" section so the lesson view is the main screen.

### Unit tests
- Lesson text parser: valid input, wrong lengths, unknown pads.
- `lessonToExpectedNotes`: positions land exactly on the given click times, including 16ths and multiple bars.
- Each starter lesson parses and produces the expected note count.
- A scripted perfect run of each starter lesson through TestSource grades 100%.
- Loop mode: notes for pass 2 start exactly one lesson length after pass 1, using click times.

## Done means
Tests, typecheck, and build pass. Then append a `## Result` section to this file covering both parts: what was built, test counts, and anything untested or uncertain.

## Result

**Status: both parts done.** `npm test` passes all 131 tests in 13 files, up from 95: part A added 11 and part B added 25. `npm run typecheck` is clean and `npm run build` succeeds. No commits were made.

### Part A: step 3b, order-preserving matching
- **The same-pad greedy pass is replaced by an order-preserving alignment per pad group** in `src/grading/match.ts`. The algorithm comment above `grade()` explains the approach and why greedy was replaced. The wrong-pad greedy pass is unchanged.
- **Deviation from the spec, please review.** NEXT_STEP asks to minimize total |offset|, but that contradicts its own required test.
  - In the 8-snare run with the middle hit removed, every remaining hit is 55 ms late.
  - The smallest total |offset| misses the *first* note and reads notes 2 to 4 as 45 ms early. That costs 355 ms, against 385 ms for the intended reading. Any per-item penalty gives the same answer, since both readings have one miss.
  - So the secondary cost is consistency instead. A matched note costs |offset − previous note's offset| when the previous note in the group was also matched, and |offset| when it starts a run.
  - That picks the intended reading, 110 against 145. It also reduces to "closest hit wins" for an isolated note.
  - The primary goal is still the most matches. That's compared exactly, not through a penalty value, because a window + 1 penalty doesn't guarantee "most matches first" once three or more pairs are involved.
- **It's implemented as a longest-chain search over in-window note-hit pairs.** Predecessors further back use a Fenwick tree, so time is roughly proportional to the number of in-window pairs. 6,000 dense 16ths grade well under the 1 s test budget.
- **Overlapping `equivalentPads` groups are now merged.** For example, [snare, snareRim] plus [snareRim, crossStick] form one group, so pad grouping is a true equivalence.
- **New tests in `alignment.test.ts`:**
  - the reproduction (+55/+60) and its early version
  - an 8-snare 16th run 55 ms late
  - the same run with the middle hit removed, which misses exactly that note with every other offset at +55
  - the same with a run 60 ms early
  - a seeded 500-case check that matches never cross
  - a seeded brute-force comparison showing the search is optimal and never matches fewer notes than any matching, even a crossing one
  - pad-group alignment, merged groups, and a performance check
- **All 95 earlier tests pass unchanged, including the live-versus-batch test.**

### Part B: step 4, first lessons
- **`src/lessons/` holds the lesson code.**
  - `Lesson` and `LessonNote` describe lessons in musical positions.
  - `parseLessonText` and `lessonFromText` read the text format. Lines look like `HH: x-x-…`. `X` marks an accent, `-` or `.` a rest, and `|` or spaces are ignored. Aliases include HH, SN, KK, BD, and RD, and full pad names also work.
  - Errors carry line numbers for wrong lengths, mismatched lines, unknown pads, bad characters, duplicate pads, and missing colons.
  - `formatLessonText` writes a lesson back to text.
- **`lessonToExpectedNotes(lesson, clicks, { startBar, passes })` places each note on its click's exact time.** Nothing is recomputed from BPM, so mid-run tempo changes stay in sync. It refuses a metronome grid that doesn't match the lesson's subdivision or beats per bar.
- **Note ids encode the pass**, as `id#pass.index`. `resultForPass()` splits a looped grade per pass: notes by id, and extra hits by time window.
- **`lessonNoteSource()` is the LiveGrader note source.** It re-reads the grid 250 ms behind each fetch window, so a click that moved backward across a window edge is still found. That can happen when the clock reference changes at start-up. A test shows a note lost without the overlap and found with it.
- **Four starter lessons**, each 2 bars:

  | Lesson | Notes | Default BPM | Any hi-hat counts |
  |---|---|---|---|
  | Quarter-note rock | 16 | 80 | yes |
  | 8th-note rock | 24 | 90 | yes |
  | Kick variation | 26 | 85 | no |
  | 16th hi-hat | 40 | 65 | no |

- **The page is now the practice screen.**
  - It has a lesson picker, a BPM control, a loop toggle, and Start/Stop.
  - Each lesson shows its pattern and the keys for its pads.
  - The beat dots show "Pass n · Bar b of 2".
  - Each hit and miss shows live colored feedback, and the lesson's pad chips flash.
  - Each pass gets a summary with its pass number, plus pass history chips and the session-best accuracy, which also appears in the picker.
  - Start always plays a 1-bar count-in. Loop mode grades each pass separately with one LiveGrader and splits the results per pass.
  - All earlier tools are under a collapsed "Debug" section: metronome controls, grade test, pad tiles, key map, and hit log.
  - Shared summary rendering lives in `src/ui/summary.ts`.
  - A dev-server-only `window.__drumly` handle exists for console and browser-script testing. It's stripped from production builds, which I checked.
- **New tests** in `parse.test.ts` and `expected.test.ts`:
  - parser happy paths, every error case, triplets, and round-trip formatting
  - starter lesson note counts
  - notes landing exactly on irregular click times, including 16ths across bars
  - count-in skipping and accents
  - rejecting a mismatched grid
  - loop pass 2 starting exactly on the click one lesson length later
  - partial fetch windows
  - a perfect TestSource run of each starter lesson grading 100%
  - the `resultForPass` split and the fetch overlap

### Verified in headless Chrome
These runs used the dev server with the real metronome, Web Audio clock, worker, and requestAnimationFrame. Hits were scripted through TestSource on the real click times.
- **A single 8th-note run graded 24 of 24 at 100%.** The result appeared about 150 ms after the last note, as designed.
- **Loop mode on the 16th lesson reported each pass separately.**

  | Pass | How it was played | Accuracy |
  |---|---|---|
  | 1 | perfect | 100% |
  | 2 | 30 ms late | 100% |
  | 3 | not played | 0%, 40 missed |

  The bar label advanced to "Pass 4". Stop ended the run and the metronome, and session bests showed in the picker.
- **The debug "Replay: Perfect run" still passes its check.**

### Open issues and uncertainty
- **One unexplained early run.** Before the guards were added, the first lesson run in one browser session graded only 17 of 24 notes, all 17 perfect. I couldn't reproduce it in 11 later cold starts, with or without hits. Two mechanisms could cause it, and both are now covered:
  - Clock-shift loss in the note fetches. The fetch overlap fixes it, and a test proves it.
  - A pass reported before the metronome grid could show all its notes. A pass is now reported only once every one of its notes is in the grid.

  If a pass ever grades fewer notes than the lesson has, the page shows a visible warning and logs to the console instead of failing silently.
- **Loop summaries are snapshots.** They're taken about 150 ms after a pass's last note. A hit arriving later can still change the live alignment, which is rare. Single runs use the final batch grade.
- **Untested here:** a real person playing on the keyboard, the sound and visuals, background tabs, and the MIDI kit. The timing thresholds are still untuned, as CLAUDE.md says.
- **The consistency cost is new behavior worth checking with real playing.** When the hits genuinely fit two readings, it prefers the reading with smaller offsets. One example is 7 hits for 8 evenly spaced notes, with the gap at the start or end.
