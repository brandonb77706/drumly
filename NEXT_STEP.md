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
