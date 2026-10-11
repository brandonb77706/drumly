# Next step: 8b (recording and listen fixes), then Step 9 (import fills and songs)

Read CLAUDE.md first. Steps 7b and 8 were reviewed: 322 tests, typecheck, and build pass, the bundle still has no SDK or key, and sound scheduling uses the audio clock (no timers in `src/sound/`). The reviewer looked at `docs/steps/step-8-listen.png`. The previous step file is archived in `docs/steps/step-7b-8.md`. The user checked Preview, Listen then play, and Compare by ear on Around the toms: sound, balance, and timing are fine, so keep the voice levels as they are.

The user is not adding an API key for now. Build the image import fully with mocked tests, but make sure the app never nags about the key: the "Import from image" option shows a short note ("Needs an Anthropic API key in .env") and everything else works normally. Don't report the untested real-key path as a problem.

Do part A first, then part B.

## Part A: Step 8b, fixes

1. **Recording drops the landing note (confirmed with a failing test).** Record 1 bar of 16ths at 60 BPM, play a fill, and land on crash plus kick on the next downbeat (4000 ms). `quantizeHits` drops the crash and kick because step 16 is outside `gridSteps`. Almost every fill ends on that landing, so this breaks the main use of Record. Fix: a recording always includes one extra "landing" step, beat 1 of the bar after the last recorded bar. Keep recording until half a step after that downbeat. When saving, make the lesson bars + 1 long (the extra bar holds only the landing), and set the focus range to end on the landing. Add this test: the fill above keeps the crash and kick on bar 1 beat 0 of the extra bar. Also add a test that a hit more than half a step after the landing is still dropped.
2. **Bar numbers in Listen mode.** The screenshot says "Your turn · Bar 1 of 2" during Around the toms' fill, while the description, the full lesson, and the Trainer call it bar 2. Use the lesson's own bar numbers everywhere (status line, problem spots, coach), so the same note always has the same name. Example: "Your turn · bar 2 of 3". Update tests.
3. **Next-lesson tip for recorded fills.** Don't say "That's the hardest fill here" for a fill in "My fills". Suggest raising the target BPM by 10 instead, or recording another fill.
4. **Record preview.** The highway preview of a recording shows only the first 1.5 s, standing still. Show the whole recording fitted to the canvas width as a static view (no scrolling) until "Play it back" is pressed.

## Part B: Step 9, import fills and songs

### Goal
Bring in fills from outside the app: a screenshot of drum notation (from a book, a website, or the notation shown in a lesson video) or a MIDI file. Everything imported goes through a review screen before it becomes a lesson, because imports can be wrong.

### 1. Shared import review screen
- Any import produces lesson text (the existing text format) plus suggested BPM, beats per bar, grid, title, and focus range.
- The review screen shows the text (editable), live parse errors with line numbers, the highway preview (whole thing, static), "Play it" with the drum engine, and "Save as lesson" into "My fills" (or "My songs" for longer imports).
- Nothing is saved without the user pressing Save.

### 2. Notation screenshot import (Claude vision)
- "Import from image" accepts a pasted image (Cmd+V), a dropped file, or a file picker (PNG, JPG, WebP). Downscale client-side to at most 1568 px on the long edge before sending.
- New server route `POST /api/import-notation` in the existing dev-server plugin. Reads the key from `.env` only. Model from `IMPORT_MODEL`, default `claude-sonnet-5-5` (reading notation needs a stronger model than coaching). Add `IMPORT_MODEL` to `.env.example`.
- System prompt: explain standard drum notation (staff positions: kick bottom space, snare middle, hi-hat x above the staff, crash x with ledger line, toms on the upper spaces, floor tom low space; noteheads, beams, rests, accents, triplets, repeat signs) and the app's text format with an example. Ask for JSON: `{ title, bpm, beatsPerBar, grid: 'sixteenth' | 'triplet', text, confidence: 'high' | 'medium' | 'low', notes: string }`, where `notes` lists anything uncertain ("couldn't tell if bar 2 beat 4 is tom 2 or tom 3"). Use the JSON schema output format, same as the coach.
- Server-side validation: run the returned `text` through the existing lesson text parser. If it fails, send the parse error back to Claude once and ask for a corrected version. If it still fails, return the error to the UI. Timeout 30 s.
- The review screen shows the confidence and the uncertainty notes above the text, so the user knows what to check against the image. Show the original image next to the highway for comparison.
- No key → a clear message: "Image import needs an Anthropic API key in .env." (Everything else still works.)
- Tests: mock the SDK. Cover a valid response, a response whose text fails to parse then succeeds on retry, failing twice, timeout, and no key. No real API calls in tests.

### 3. MIDI file import
- "Import MIDI file" accepts `.mid` and `.midi`. Use `@tonejs/midi` to parse (well tested; don't write a MIDI file parser).
- Take drum notes from channel 10, or from the track the user picks if channel 10 is empty. Map notes with the existing `MIDI_NOTE_TO_PAD`; list unmapped note numbers in the review screen instead of silently dropping them.
- Use the file's tempo and time signature as the suggested BPM and beats per bar. Quantize with the existing quantize function (16ths by default, triplets selectable), so imported timing lands on the grid.
- Let the user choose a bar range to import (for example bars 9 to 12) before reviewing, so a fill can be pulled out of a full song.
- Tests: build small MIDI files in tests with `@tonejs/midi` itself (no binary fixtures needed): a 1-bar fill, a file with a tempo change (use the first tempo and warn), a file with unmapped notes, and a bar-range selection.

### 4. Songs and section looping
- Imports longer than 4 bars save as songs ("My songs") instead of fills.
- Songs get section looping: choose start and end bars (A-B loop), loop that range with the normal grading, Trainer, Listen-then-play, and Compare features. The highway shows the loop range.
- Live grading for long songs: you noted earlier that live regrading re-runs the whole grader on every hit. Narrow it to notes within the window of the current position (the alignment DP already supports banding), and add a test that grading a 64-bar song stays under a reasonable time budget (for example 50 ms per hit in the test environment).
- The app ships no copyrighted song transcriptions. Songs only come from the user's own imports.

## Done means
Tests, typecheck, and build pass with no `.env` present. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome. Save a screenshot of the import review screen for a MIDI import as `docs/steps/step-9-import.png`. Then append a `## Result` section covering both parts, including whether image import was tried with a real key (only if the user created `.env` themselves; never ask for or handle the key).

## Result

### Part A: Step 8b
1. **Recording keeps the landing.** `RecordGrid` has a `landing` option. With it, `quantizeHits` keeps one extra step: beat 1 of the bar after the last recorded bar. Notes there come out in bar `bars`. Recording already ran until half a step after that downbeat.
   - A saved recording is bars + 1 long, with the extra bar holding only the landing. Its focus is stored with the lesson and ends on the landing.
   - `CustomLessonData` gained optional `kind`, `focus` and `origin` fields. Entries saved before this step still load, with their old whole-bar focus.
   - Tests:
     - The 1-bar fill at 60 BPM keeps the crash (accented) and kick on bar 1, beat 0 of the extra bar. Without the landing step they were dropped, as before.
     - A hit 126 ms after the landing (more than half a step) is dropped, and one at 124 ms is kept.
     - A step after the landing is dropped even when hit dead on.
     - The saved lesson is 2 bars, with its focus ending on the landing.
   - While recording, the bar label reads "Recording · bar 1 of 1", then "Recording · the landing".
2. **One name per note.** `sectionLesson` (now built on a new `barsLesson`) records `section: { firstBar, totalBars }`, and it stacks when a section is cut again. The status line, problem spots, coach report (`where`, `bar`, `fill.bar`) and spot drills all go through `fullBar()`.
   - In Listen mode on Around the toms, the label reads "Listen · bar 2 of 3", then "Your turn · bar 2 of 3".
   - Tests: section labels, a Tom 2 problem spot described as "(bar 2)" by both the Trainer and the coach report, and `fill.bar` = 2.
3. **Next-lesson tip for your own fills.** The report has `lesson.mine` (true for anything that isn't a built-in lesson).
   - The rule-based coach says "Raise the Trainer's target to 75 BPM, or record another fill to learn." For songs it suggests looping the next section.
   - The Claude coach's system prompt has the same rule.
   - Tests: a learned fill of your own never says "hardest", and a learned song section reads "Section learned at 90 BPM. Nice work."
4. **Record preview.** The highway renderer has a `fit` mode: it shows a given time span across the whole note area, standing still, with no now line. In this mode notes shrink to fit dense material.
   - `lessonOverview()` lays out a whole lesson on its own time axis.
   - The record preview, all import previews and the song overview use it. "Play it" scrolls as before.

### Part B: Step 9
- **Shared review screen** (`src/import/draft.ts`, the review panel in `main.ts`). Record, MIDI and image import all produce an `ImportDraft`: text, title, BPM, beats per bar, grid, whether it ends in a landing bar, and things to check.
  - The review shows:
    - the editable text, with live parse errors (with line numbers), title, BPM, beats per bar and grid;
    - what to check (warnings, plus Claude's confidence and uncertainty notes for images) and the original image;
    - the whole thing on the highway, fitted and standing still (the last good picture stays up while the text has an error);
    - "Play it" with the drum engine, Save and Discard.
  - The kind line says where it will be saved, for example "Saves under My fills: 1 bar plus the landing." or "My songs: 12 bars".
  - Nothing is stored until Save. Record now uses this same screen (its old result box is gone).
  - Imports longer than 4 bars (not counting a landing bar) save as songs. Fills get a focus range, ending on the landing when there is one; songs have none.
- **MIDI import** (`src/import/midi.ts`, `@tonejs/midi` 2.0.28).
  - Notes come from channel-10 tracks. If there are none, the busiest track is used, with a warning, and a Track select lets you pick another.
  - Notes are mapped with `MIDI_NOTE_TO_PAD`. Unmapped note numbers are listed with counts ("Left out 2 notes with no pad: note 56 (2×)").
  - The first tempo and time signature become the suggestions. A tempo change or time-signature change is used as the first value, with a warning.
  - Notes are placed by tick position, so a tempo change can't push them off the grid, then snapped with the same `quantizeHits` as Record (16ths or triplets).
  - You can choose a bar range. A range of 4 bars or fewer also keeps its landing on the next downbeat.
  - Tests build files with `@tonejs/midi`:
    - a 1-bar fill with loose timing, with its landing;
    - a tempo change (90, then 140): uses 90 and warns, notes stay in place;
    - unmapped notes;
    - bars 9–10 out of a 12-bar song;
    - an 8-bar range saved as a song;
    - triplets in 3/4;
    - no channel-10 notes;
    - bytes that aren't MIDI.
- **Image import.**
  - Route `GET/POST /api/import-notation` in the existing dev-server plugin (`server/importRoute.ts`, `server/importNotation.ts`). The key comes from `.env` only.
  - The model comes from `IMPORT_MODEL`, default `claude-sonnet-5-5`, and is added to `.env.example`. The request has a system prompt on drum notation and the text format, the image as base64, and json_schema output (`effort: 'medium'`).
  - The returned text is checked with `parseLessonText`. If it fails, Claude gets its own reply back plus the parser's error, once. If it still fails, the UI gets the error and the last text, and the review opens so it can be fixed by hand.
  - There is one 30 s deadline for both calls. A refusal or cut-off reply counts as invalid. API errors are sorted like the coach's.
  - The browser downscales to at most 1568 px on the long edge (`fitWithin`, tested) and accepts paste (only while the import panel is open), drop, or a file picker.
  - **Without a key:** "Import from image" shows only "Needs an Anthropic API key in .env." and the picker is off. A pasted image while the panel is open gets "Image import needs an Anthropic API key in .env." Everything else works normally.
  - Tests with a mocked SDK:
    - a valid reply (model, system prompt, schema and image block checked);
    - a parse failure fixed on the retry (the second request carries the first reply unchanged plus "Line 2 (KK) has 12 steps…");
    - failing twice;
    - wrong-shape, refusal and max_tokens replies;
    - a timeout that aborts the request;
    - no key (no SDK constructed);
    - the route (GET availability, 400s, and the endpoint constant matching the client);
    - `IMPORT_MODEL` read from `.env`.
  - **No real API call was made.**
- **Songs and section looping.**
  - A song shows "Loop bars A to B" and "Whole song" controls, defaulting to bars 1–4. The idle highway shows the whole song fitted, with the loop range shaded and labelled "loop".
  - Start, Loop, the Trainer, Listen-then-play and Compare all run on `barsLesson(song, A, B)`, with labels in song bars ("Pass 1 · bar 9 of 12").
  - If the range is entered backwards, the other end moves along instead of swapping (I hit that in the browser check).
  - "My songs" is its own group in the picker, and the delete button says "Delete song".
  - No songs ship with the app.
- **Live grading for long songs.** `LiveGrader` now settles notes more than `settleMs` (default 2 s) before the miss deadline. Their results are frozen and they leave the live regrade, together with the hits they took and extras too early to match a live note. `getResults()` merges settled and live results, and `stop()` still batch-grades everything.
  - On a 64-bar song (1,280 notes) the live set never exceeded 80 notes, and every hit stayed under the 50 ms budget (a few ms, in practice).
  - **One behavior change to know about:** the alignment scores timing consistency along a whole hi-hat run, so later playing could previously flip a near-tie far back. With settling, verdicts older than about 2 s are final.
    - With ±20 ms playing on 16ths, live and the full batch grade agree exactly (tested).
    - With very sloppy ±50 ms playing, 2 to 11 of 1,280 notes read differently (wrong pad vs extra), with identical accuracy (tested: under 1%, same accuracy).

### Tests
**364 pass** (up from 322). Typecheck and build pass, all with no `.env` present. `dist` has no SDK code, key or model name.

### Checked in headless Chromium
I used my own Playwright headless shell with `--mute-audio`, never your Chrome. The dev server ran with no `.env`. **42 of 42 checks pass.**
- **No key:**
  - only the short note shows, and the picker is off;
  - a paste gets the clear message;
  - MIDI works.
- **MIDI, bar 10 of a 12-bar file:**
  - the text has the landing crash (accented) and kick in the extra bar, and loose timing is snapped;
  - the unmapped note 56 is listed;
  - the suggested BPM (96) and title are filled in;
  - the highway is fitted and static;
  - a bad edit shows "Line 7 (KK) has 28 steps…" and keeps the last preview;
  - Play it booked all 15 drums;
  - nothing was stored until Save, which made a 2-bar fill with its focus ending on the landing, under My fills.
- **The whole 12 bars:**
  - saves under My songs;
  - the loop controls and the shaded "loop" range show;
  - looping bars 9–11 plays a 3-bar section labelled "Pass 1 · bar 9 of 12", and a scripted clean pass grades 100%.
- **Record** (1 bar at 100 BPM, jittered, landing on crash + kick):
  - the label reads "Recording · the landing";
  - the review has both landing notes;
  - the preview shows all 10 notes, fitted;
  - it saves as 2 bars with the focus ending on the landing.
- **Listen mode** on Around the toms: "Listen · bar 2 of 3", then "Your turn · bar 2 of 3".
- **Image import UI, with the server answers stubbed in the browser** (no API involved):
  - the image is sent as base64 PNG;
  - the review shows "Claude's confidence: medium", the uncertainty note and the original image;
  - a parse-failed answer opens the review with the parser's line-numbered error.
- **Console:** only the usual headless Web MIDI permission warning.
- **Screenshot:** `docs/steps/step-9-import.png` is the MIDI review screen.

### Image import with a real key
**Not tried.** There is no `.env` here, and I didn't ask for or handle a key. Everything up to the API call is tested, and the request shape matches the claude-api reference.

### Open issues and notes
- **Lesson description during review.** While a review is open, the line under it still describes the selected lesson (visible in the screenshot). It's harmless, but could be hidden during review.
- **Fill detection on imports.** An image import's focus is the whole transcription, since Claude isn't asked where the fill starts. A MIDI fill's focus starts at its first bar. You can't edit focus ranges in the review yet.
- **Stored fills from before this step** (recorded without a landing) keep their old length and focus.
- **Very dense overviews.** A whole long song squeezes into one canvas width, which works as an overview, but a 64-bar song at 16ths has dots about 1 px apart.
- **CLAUDE.md** still lists step 9 as not done. Nothing is committed.
