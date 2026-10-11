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
