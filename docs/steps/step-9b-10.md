# Next step: 9b (import polish), then Step 10 (save sessions and track progress)

Read CLAUDE.md first. Steps 8b and 9 were reviewed: 364 tests, typecheck, and build pass with no `.env`, and the bundle has no SDK or key. The reviewer looked at `docs/steps/step-9-import.png`. The previous step file is archived in `docs/steps/step-8b-9.md`.

**Decision on settled verdicts:** keep the 2-second settling. The reviewer confirmed `LiveGrader.stop()` still runs the full batch grader as the final word, so pass summaries, problem spots, and coaching stay exact. Only live colors can differ, and only for very sloppy playing. Add one line to the `settleMs` comment saying the summary always comes from the full grade.

Do part A first, then part B.

## Part A: Step 9b, import polish

1. **The page describes the wrong lesson during a review (you flagged it, confirmed in the screenshot).** While a review is open, the description, the keyboard key list, and the pad tiles still show "Quarter-note rock beat" (only hi-hat, kick, snare), while the preview shows toms. While a review is open, all three must describe the imported pattern. Restore the selected lesson when the review is discarded or saved.
2. **Unmapped notes are only reported.** "Left out 2 notes with no pad: note 56" is clear, but the user can't fix it. Next to each unmapped note number, add a dropdown to map it to a pad (or "ignore"), and re-run the import with that mapping. Show the General MIDI name when known (56 is cowbell). Keep the mapping only for this import.
3. **Edit the focus range in the review.** Add start and end pickers (bar and beat). Default to what the import suggested. The preview shading follows the pickers.
4. **Dense long songs in the static preview.** When the content needs more than about 40 px per beat to read, make the static preview horizontally scrollable at a readable zoom instead of squeezing everything into one width, with a small bar-number ruler on top.

## Part B: Step 10, save sessions and track progress

### Goal
Practice should add up. The player sees their history, personal bests, which fills are improving, and how fast they can play each one cleanly.

### 1. Storage
- Use IndexedDB (through the small, well-known `idb` package) for sessions. localStorage is too small once sessions add up.
- Move custom lessons ("My fills", "My songs") from localStorage into IndexedDB, with a one-time migration that keeps existing saved fills. Keep reading the old localStorage key once, then remove it after a successful migration.
- Every database call is wrapped so the app still runs, with a visible "History isn't saving in this browser" notice, if IndexedDB is unavailable (private window, blocked storage).
- **Pin the dev server port.** Browser storage belongs to the exact address, so if Vite moves from port 5173 to 5174, all history looks gone. Set `server.port` to 5173 with `strictPort: true` in `vite.config.ts`, and mention this in the Result section.
- Keep a `schemaVersion` and a migration function, so later steps can change the stored shape safely.

### 2. What gets saved
After every session (any mode), save a compact record. Don't save every raw hit for every pass, because that grows fast:
- id, date and time, lesson id and title (copy the title, since custom lessons can be deleted), category, mode (practice, trainer, listen, record), source (keyboard or MIDI)
- per pass: BPM, accuracy on focus and whole lesson, mean offset, spread, counts by status, whether it was clean by the ladder
- trainer outcome: start BPM, highest clean BPM, whether the fill was learned
- the session report from step 7 and the coaching that was shown
- raw hits only for the best pass (so Compare can replay it later)
- total time spent playing

### 3. Progress screen
A new "Progress" view (a tab next to Practice):
- **Overview:** total practice time this week, days practiced in a row (streak), sessions this week, a 7-day bar chart of minutes per day.
- **Per lesson:** a list of every lesson played, with best accuracy, highest clean BPM, last played, and a small trend arrow.
- **Lesson detail:** a line chart of accuracy over time and a line chart of highest clean BPM over time (the main "am I getting faster" chart), the latest problem spots, and the session list with dates.
- **Replay a best pass:** from the detail view, open Compare with the stored best pass hits.
- Draw charts with plain SVG (no chart library needed for lines and bars). Keep the chart data math in pure, unit-tested functions.

### 4. Personal bests
- Track per lesson: best accuracy at or above the lesson's default BPM, and highest clean BPM.
- When a pass beats a personal best, show a small "New best" message during practice. Don't interrupt playing; show it at the end of the pass.

### 5. Backup
- "Export history" downloads a JSON file with sessions, custom lessons, and settings. "Import history" reads that file back, merging by id without duplicating, after a confirmation showing how many sessions and lessons it contains.
- Validate imported files (schema version and shape) and reject bad files with a clear message.

### Unit tests
Use `fake-indexeddb` in tests.
- Save and load a session; sessions list newest first; per-lesson queries.
- Migration: existing localStorage custom lessons move to IndexedDB once, and nothing is lost if migration fails halfway.
- Streak math: consecutive days, a gap resets it, local time zone midnight boundaries (test a session at 11:59 pm and one at 12:01 am).
- Weekly minutes and the 7-day chart data.
- Personal bests: only clean passes count for highest clean BPM; accuracy best requires at least the default BPM.
- Export then import round trip gives identical data; importing twice doesn't duplicate; a malformed file is rejected.
- App still works when IndexedDB throws (storage unavailable).

## Done means
Tests, typecheck, and build pass with no `.env`. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome. Run a few scripted sessions, reload the page, and confirm history survived. Save a screenshot of a lesson detail view with both charts as `docs/steps/step-10-progress.png`. Then append a `## Result` section covering both parts.

## Result

### Part A: Step 9b, import polish
- **Review describes the import.** `showLesson` is split, and a new `describeLesson` handles the description, pattern text, key list and pad tiles. While a review is open, all of them describe the imported pattern. Discard and Save restore (or switch to) the selected lesson, and changing the lesson picker during a review keeps describing the import.
- **Unmapped MIDI notes can be mapped.**
  - `midiToDraft` takes a per-import `noteMap` (note → pad or `'ignore'`) and returns `noPad`: every note number that has no built-in pad, with its count and current choice. The built-in map never changes.
  - The review shows one dropdown per note, labelled with its General MIDI name (`src/import/gmNames.ts`, notes 27 to 87; for example "note 56 (Cowbell), 4×").
  - A change re-runs the import, keeping the edited name, BPM and focus.
  - The "Left out…" warning names only notes still unmapped. An explicit "Ignore it" removes the warning.
- **Focus range pickers.**
  - Fills get From bar/beat and To bar/beat inputs, defaulting to the suggested focus. A "Use suggested" button resets them.
  - A pick covers the start of the From beat to the last step of the To beat.
  - If the range is backwards, the end you didn't edit moves along, like the loop pickers.
  - The preview shading is the same lesson's focus, so it follows the pickers.
  - Songs show no pickers, since they are graded whole and loop bars pick the part. All of this is pure and tested in `src/import/draft.ts`.
- **Dense previews scroll.**
  - New pure function: `scrollFitLayout` (tested). Below `MIN_PX_PER_BEAT` (40 px), a fitted overview is drawn at 40 px per beat instead of squeezed.
  - A thin scroll bar under the canvas, plus trackpad sideways swipe or Shift+wheel over the canvas, scrolls it. The pad labels stay put.
  - Every fitted overview has a bar-number ruler in the header strip, in the full song's numbers, kept clear of the "graded"/"loop" label.
  - A 64-bar 16th song is about 10,400 px wide.
- **`settleMs` comment, with a correction.** The decision note says pass summaries, problem spots and coaching come from `stop()`'s full grade. In code, that was only true for single runs. In a looping run, each pass's summary, `run.passes` (the coach) and `run.takes` (Compare) came from the live results.
  - **Fix:** `stopLesson` now re-slices every pass from the final batch grade before the coach, Compare and history use it.
  - **Still live:** the summary shown at the end of each looped pass, the live colors, and the trainer's live problem-spot list.
  - **The comment** now says exactly that.

### Part B: Step 10, save sessions and track progress
- **Storage** (`src/history/store.ts`, using `idb` 8):
  - The `drumly` database has three stores:
    - `sessions`, with `byLesson` and `byStart` indexes;
    - `lessons`;
    - `meta` (holds `schemaVersion`).
  - Each record has a `schemaVersion`, and `migrateSession` (in `validate.ts`) is where future version steps go. `DB_VERSION` plus the `upgrade` blocks handle changes to the database's own structure.
  - Every call is wrapped. If IndexedDB can't open or a call fails, the store switches to memory for the page session, shows "History isn't saving in this browser…" once, and practice carries on.
- **Custom lessons moved.** `CustomLessonStore` keeps an in-memory list (sync `list()`) and writes through to the history store.
  - **Migration:** on first start, `drumly.customLessons` is copied into IndexedDB in one transaction. Existing ids win. Any failure aborts the transaction.
  - **Old key:** removed only after a successful copy. If the copy fails, the old key stays and those fills are still shown.
- **What's saved** (`src/history/record.ts`, pure). After every practice, trainer or listen run, and every recording, the record holds:
  - id, start and end times, and time played (downbeat to stop);
  - lesson id, plus a copy of its title, category and default BPM;
  - mode and source;
  - per pass: BPM, focus and whole-lesson accuracy, mean and spread, counts by status and timing, and clean-by-ladder;
  - the trainer outcome (start BPM, highest clean BPM, learned);
  - the session report and the coaching shown. A later "Get coaching" answer from Claude is saved onto the record.
  - **Raw hits:** only for the best pass, as hits relative to its downbeat, plus a text snapshot of the bars played (song loops and listen sections keep their place in the full lesson).
  - **Not saved:** runs under 10 s with no graded pass.
- **Progress tab** (`src/ui/progress.ts`, plain SVG; the geometry is pure and tested in `src/history/chart.ts`):
  - **Overview:** time this week, day streak, sessions this week, and a 7-day bar chart of minutes. "This week" means the last 7 days, the same days as the chart.
  - **Lesson list:** best accuracy (or "x% at y BPM" if never played at full speed), fastest clean BPM, last played, and a trend arrow. Recordings aren't lesson rows.
  - **Lesson detail:**
    - an accuracy line chart and a fastest-clean-tempo line chart (sessions evenly spaced, oldest left);
    - the latest problem spots;
    - the session list, with a "Replay best" button per session plus "Replay best pass" for the overall best.
  - **Replay:** rebuilds the pass from its stored bars, re-grades the stored hits with the batch grader, and opens Compare on the practice screen. It works even after the custom lesson is deleted.
- **Personal bests:**
  - **Accuracy:** best headline accuracy at the default BPM or faster (±0.05 for the one-decimal rounding).
  - **Clean tempo:** highest BPM of a clean pass.
  - **"New best" message:** "★ New best: …" appears under the feedback line when a pass beats either best, at pass end.
  - **Lesson picker:** "(best x%)" now uses the all-time best. The pass heading's "session best" is computed from the run's own chips.
- **Backup** (`src/history/backup.ts`):
  - **Export** downloads `drumly-history-YYYY-MM-DD.json`: format tag, schema version, sessions, custom lessons, and settings (click mode, hit sounds, volumes, guide drums, read-aloud).
  - **Import** checks the file. It rejects the whole file with a clear message if it isn't JSON, isn't a Drumly file, is from a newer version, or has any damaged session or lesson (the message says which).
  - Before importing it shows an in-page confirmation (no browser dialog), counting sessions and lessons and how many are new. It then merges by id in one transaction, so nothing is duplicated.
- **Dev server port is pinned:** `server.port: 5173`, `strictPort: true` in `vite.config.ts`. Browser storage belongs to the exact address, so if 5173 is busy, Vite now fails instead of moving to 5174 and making history look gone. Always open the app at `http://localhost:5173`.

### Tests
- **427 pass** (up from 364), all with no `.env` present. Typecheck and build also pass, and `dist` has no SDK code or model name.
- **New test files:** `history/store`, `stats`, `record`, `chart`, `backup`, and `import/draft`. MIDI mapping, `scrollFitLayout`, the async lesson store and `formatDuration` were added to existing test files.
- **Covered:**
  - save and load (also after reopening), newest-first and per-lesson queries;
  - migration: runs once, doesn't overwrite existing ids, and loses nothing when it fails halfway (the transaction is undone, the key kept, and it completes next time);
  - streak: consecutive days, gaps, 11:59 pm/12:01 am, month/year boundaries, and a daylight saving change;
  - the stats suite also passes with the time zone set to UTC, New York, Auckland and Kolkata;
  - weekly minutes and the 7-day data;
  - bests: only clean passes count for tempo, and accuracy needs at least the default BPM;
  - export → import gives a byte-identical re-export, importing twice doesn't duplicate, and malformed files are rejected;
  - IndexedDB failing to open, throwing synchronously, or failing mid-session;
  - a stored best pass re-grades to the identical result.

### Checked in headless Chromium
I used my own Playwright headless shell with `--mute-audio` on port 5199, never your Chrome. Your dev server on 5173 was left alone. **55 of 55 checks pass.**
- **Part A (22 checks):**
  - the review description, keys and tiles show the imported toms, and Discard restores "Quarter-note rock beat";
  - the note 56 (Cowbell) dropdown: mapping it to Ride adds a ride line, "Ignore it" drops it, and the name edit is kept;
  - the focus pickers default to 1/1–3/1, the shading moves to bar 2 beat 3, a backwards end works, and the saved fill keeps the picked focus;
  - the 64-bar song scrolls (10,360 px) by scroll bar and by sideways swipe, with readable 16ths and bar numbers; short lessons show no scroll bar.
- **Part B (29 checks):**
  - **Migration:** an old localStorage fill moved into IndexedDB, the key was removed, and the fill was still in the picker after a reload.
  - **Scripted sessions:** 7 in total.
    - rough at 63 BPM, which showed no "New best";
    - clean at 72 BPM: "★ New best: clean at 72 BPM!";
    - a trainer run 75→90, learned;
    - a 2-pass loop at 90;
    - an almost-clean pass at 95;
    - a listen session;
    - a recording.
  - **Reload:** all 7 sessions survived.
  - **Progress:** overview, 7 bars, lesson rows with a trend arrow, the detail charts (5 accuracy points, 3 clean-tempo points) and 5 session rows.
  - **Replay:** "Replay best pass" opened Compare with "Correct version, then yours (best pass of Oct 11)".
  - **Export:** the file holds 7 sessions, the fill and the settings.
  - **Import into a fresh browser:** a damaged file was rejected; the confirmation read "7 sessions (7 new)"; a second import showed "(0 new)", and the total stayed at 7.
- **Storage blocked (4 checks):** the notice shows, a session still grades, and Progress shows it for the page session.
- **Console:** only the usual headless Web MIDI permission warning, plus the expected "History storage is unavailable" warning in the blocked run.
- **Screenshot:** `docs/steps/step-10-progress.png` shows the overview and the lesson detail, with both charts.

### Bugs caught by the browser check
- **History open moved earlier.** Opening the history store with a top-level `await` after the animation loop started let the first frame run before later declarations existed (a TDZ error on `compareRun`). That stopped the loop, so lessons never left the count-in. History now opens before the loop starts, and the comment says why.
- **Cosmetic:** "best pass of oct 11" was lower-cased.

### Open issues and notes
- **Can't be tested without the kit:** sessions record `source`, and the session list marks kit sessions, but no MIDI session has been saved.
- **Song bests are per song, not per loop range.** A clean loop of bars 1–4 counts toward the song's fastest clean tempo.
- **Session dates are evenly spaced on the line charts** (by session, not by real time), so several sessions on one day don't bunch up. Dates show under the first, middle and last points.
- **Switching to Progress stops whatever is playing**, and it is saved first.
- **Settings still aren't kept between page loads.** Click mode is per page session as before. Settings only travel in the export file.
- **CLAUDE.md** still lists step 10 as not done. Nothing is committed.
