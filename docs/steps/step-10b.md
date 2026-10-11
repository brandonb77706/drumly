# Next step: 10b (progress polish, exact pass summaries, README)

Read CLAUDE.md first. Steps 9b and 10 were reviewed: 427 tests, typecheck, and build pass with no `.env`, the bundle has no SDK or key, and the port is pinned to 5173. The reviewer looked at `docs/steps/step-10-progress.png`. Thanks for correcting the reviewer: looped runs were using live results for the coach and Compare, and you fixed it. The previous step file is archived in `docs/steps/step-9b-10.md`.

Step 11 (Kit day) has to wait until the Roland kit is back around Oct 25. This step is the last one before that.

## 1. Exact per-pass summaries in loops
The summary shown at the end of each looped pass is still live. A pass is only a few bars, so grading it in full is cheap. At the end of each pass, run the batch grader over just that pass's notes and hits (with the matching window extended by `windowMs` on both edges so boundary hits are handled), and use that for the pass summary, the pass chip, the ladder decision, personal bests, and the saved session. Live colors during play can stay settled/live. Add a test where a sloppy looped run gives a pass summary identical to a batch grade of that pass.

## 2. Progress chart x-axis
In the screenshot, every x-axis label reads "Oct 11", because all sessions were the same day. Label points by date when sessions span multiple days, and by time ("1:26 PM") when they're all on one day. Show at most about 6 labels, so they never overlap. Hovering (or tapping) a point shows that session's date, time, accuracy, and BPM. Keep the label logic in a pure tested function.

## 3. Remember settings between page loads
Settings (click mode, volumes, hit sounds, guide drums, speed, last lesson, trainer settings, Progress tab state) reset on reload. Save them in localStorage as a per-browser convenience, wrapped in try/catch so a blocked storage doesn't break anything. Include them in the existing export file as now. Test load, save, and a corrupted or missing value falling back to defaults.

## 4. README for the portfolio
Write `README.md` for someone seeing the project on GitHub:
- one-paragraph pitch and a screenshot (use the existing step screenshots in `docs/steps/`)
- feature list in plain language
- how it works: input layer, Web Audio lookahead scheduling and clock alignment, the order-preserving alignment grader (why greedy failed), the tempo ladder, the coach with rule-based fallback
- tech stack, how to run (`npm install`, `npm run dev`, Chrome or Edge for MIDI), optional `.env` for the Claude features
- testing: how many tests and what the browser checks cover
- privacy note: history stays in the browser; the API key stays in `.env` on the local server
Keep it honest: say the real kit hasn't been tested yet and thresholds will be tuned on Kit day.

## Done means
Tests, typecheck, and build pass with no `.env`. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome, and never the user's dev server on 5173. Append a `## Result` section.

## Result

### 1. Exact per-pass summaries in loops
- **New pure function** `gradeSpan` (`src/grading/span.ts`), exposed on the live grader as `LiveGrader.gradeSpan`. It batch-grades one pass using every note and hit the grader has received, so live settling has no effect on it.
  - **Edges:** it grades the notes within two matching windows of each edge and the hits within three. A hit near a downbeat can then go to either pass's note, as in a grade of the whole run. It returns only the pass's notes, plus extras in `[start − window, end − window)`, the same split as before, so each stray hit counts in exactly one pass.
- **In the app:** when each looped pass ends, `main.ts` now uses this grade for the summary, the chip, the ladder decision, personal bests, Compare, the coach and the saved session. The old step that replaced pass results with slices of the final grade at Stop is gone, so what was shown is exactly what gets saved. Live colours still come from the live grade, and at Stop the highway shows the final whole-run grade.
- **Bug caught in the browser:** the first version picked a pass's notes by time. It graded 22, 24 and 26 notes in three passes that each have 24. A note's stored time can be a fraction of a millisecond off from the downbeat read later, because the metronome refreshes its clock reference. A downbeat note then fell into the wrong pass. Notes are now picked by pass id (`notePass`), like the old slicing did. A unit test covers a 0.1 ms drift.
- **Tests** (`span.test.ts`, 7 tests):
  - a sloppy looped run (±50 ms on 16ths, with misses, wrong pads and extras, default settling): every pass summary is identical to a batch grade of that pass made after the run;
  - the live (settled) slice really does differ on at least one pass of that run, so the change matters;
  - normal playing (±20 ms): each pass equals its slice of the whole-run grade exactly;
  - very sloppy playing: fewer than 2% of notes are read differently from the whole-run grade;
  - boundary cases: a hit just before a downbeat goes to the downbeat, and a stray hit between passes counts once.

### 2. Progress chart x-axis
- **New pure function** `xAxisLabels(times, { maxLabels = 6, locale })` in `src/history/chart.ts`.
  - It uses dates ("Oct 9") when the sessions span more than one local day, and times ("1:26 PM") when they're all on one day. In that case the day goes in the chart caption ("… · Oct 11").
  - At most 6 labels, spread evenly from the first point to the last. A text already shown isn't repeated (several sessions on one day or in one minute).
- **Hover or tap a point** to see that session's date, time, best accuracy, and the tempo of that best pass. A tap pins the tooltip and a second tap hides it. Each point has a 14-unit invisible target, and the tooltip stays inside the chart near the edges. `lessonSeries` now returns this `info` for each session.
- **Tests:**
  - times on one day and dates across days;
  - 11:59 pm and 12:01 am count as different days;
  - 40 sessions get 6 labels from first to last;
  - same-minute sessions share one label; one session; none;
  - a geometry check that 6 labels are more than 60 units apart on the real chart.
  - Time strings are normalized for ICU's narrow no-break space.

### 3. Settings between page loads
- **New module** `src/history/settings.ts`:
  - `loadSettings` and `saveSettings` on the `drumly.settings` key, both wrapped in try/catch.
  - The storage is passed as a function, because just touching `window.localStorage` can throw when it's blocked.
  - Each field is validated on its own by the existing `readSettings`, now with range checks, so one bad value falls back to its default without losing the others.
- **What's saved:**
  - click mode, hit sounds, drums and click volume, guide drums, read-aloud;
  - speed, last lesson, and the loop, trainer and listen checkboxes;
  - the trainer's step, clean threshold and passes needed. Start and target BPM are per lesson, so they still come from the lesson;
  - the open tab and the open Progress lesson.
- **When it's saved:** after any committed form change (one `change` listener on the document, which runs after the control's own handler), on tab switches, and when the Progress view changes.
- **Restoring:** at startup, after the lesson picker is built. A saved lesson that no longer exists falls back to the first lesson.
- **Click mode** used to live in sessionStorage. It's now part of these settings.
- **Export and import:** the export file carries the same settings, so it gained the new fields. Import applies the practice settings but not the tab or the lesson.
- **Tests:** save then load round trip; nothing saved; damaged JSON, a string, null and an array; bad fields falling back one by one; blocked storage on both read and write.

### 4. README
- `README.md`:
  - the pitch, with a new screenshot (`docs/steps/step-10b-progress.png`) and the highway, trainer and coach screenshots from earlier steps;
  - the feature list;
  - how it works: the input layer, lookahead scheduling and clock alignment, the alignment grader and why greedy failed, the tempo ladder, and the coach's rule fallback;
  - the stack, how to run it, the optional `.env`, testing, and privacy.
- It says plainly that the kit hasn't been tested and that thresholds get tuned on Kit day.
- **Caveat:** the new screenshot uses scripted test data. The fastest-clean-tempo line zigzags because the same three sessions were copied back over several weeks.

### Tests
- **446 pass** (up from 427), with no `.env`. `npm run typecheck` and `npm run build` pass, and `dist` has no SDK code or model name.

### Checked in headless Chromium
I used my own Playwright headless shell with `--mute-audio` on port 5199, never your Chrome, and left your dev server on 5173 alone. **28 of 28 checks pass.**
- **Loops (8 checks):**
  - a sloppy 4-pass loop at 140 BPM (misses, wrong pads, extras); each pass graded all 24 notes;
  - every pass grade equals a batch grade of that pass made after the run;
  - the chips, the pass heading and the saved session show the same accuracies.
- **Chart (10 checks):**
  - one day: time labels, with the date in the caption;
  - hover shows "Oct 11, 2:00 PM / 100% accuracy / 90 BPM" and hides when the pointer leaves; tap pins it and a second tap hides it;
  - 27 sessions over 3 weeks: 6 date labels, no repeats, no overlap, also at a 390 px width.
- **Settings (10 checks):**
  - all 12 controls, the click mode applied to the metronome, the Progress tab and the open Progress lesson all survive a reload;
  - the export file carries the settings;
  - damaged JSON gives defaults, and a single bad field falls back alone;
  - with localStorage blocked, settings still apply for the page and a lesson grades.
- **Console:** only the usual headless Web MIDI permission warning.
- The Vite helper handles for page scripts in dev builds now also include `summarize` and `gradeSpan`.

### Open issues and notes
- **Replays of saved passes can differ slightly at the edges.** A saved pass's raw hits are still stored over `[start − window, end − window)`, and a replay re-grades them without neighbouring notes. For a hit right at a pass edge, the replay in Compare can differ slightly from the saved pass grade. The saved numbers are the exact pass grade.
- **Late stray hits can be missed.** A pass is reported 150 ms after its last note's window, as before. A stray hit after that but before the next downbeat's window isn't in that pass's extras.
- **Latency offset isn't saved.** It belongs to Kit day calibration.
- **Can't be tested without the kit:** MIDI timing, latency, pad zones and thresholds.
- Nothing is committed.
