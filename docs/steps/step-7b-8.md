# Next step: 7b (coach polish), then Step 8 (hear it, then play it)

Read CLAUDE.md first. The build order changed: drum sounds and recording come next, imports are step 9, saving is step 10. Steps 6b and 7 were reviewed: 280 tests, typecheck, and build pass. The reviewer confirmed the browser bundle has no SDK code or key, `.env` is ignored, and `.env.example` is tracked. The previous step file is archived in `docs/steps/step-6b-7.md`.

Do part A first, then part B.

## Part A: Step 7b, fixes from the coach screenshot

1. **Coach contradicts itself.** The headline says "Fill learned. Nice work" and "Next time: move on to Full-bar tom run", while "Fix this" says Tom 2 keeps landing on Tom 3. Rule: if there are qualified problem spots, `nextExercise` must drill the worst one first (for example "Loop just beats 3 and 4 of bar 2 at 55 BPM until Tom 2 is clean 3 times in a row, then try the full fill"). Only suggest the next lesson when there are no problem spots. Soften the headline when the fill was learned with problem spots ("Fill learned at 65 BPM. One spot to clean up."). Add the same rule to the Claude system prompt. Test both cases.
2. **Repetition.** The headline "Fill learned at 65 BPM" and the wentWell item "You learned it at 65 BPM" say the same thing. wentWell items must not repeat the headline. Test it.
3. **Pass chip colors don't match the ladder.** Passes 3 and 4 at 90% counted as clean (threshold 90%) but their chips are gray while the 100% chips are green. Chip color must follow the ladder's own verdict: green clean, gray "almost", red rough.
4. **Claude path check.** I can't confirm `output_config` with `effort` and a JSON schema format is accepted by `claude-haiku-5-5`. If an API call fails because of a parameter, log the API error message to the server console clearly (already done) and also show the reason in the UI next to "Quick tips" (for example "Claude coach unavailable: API rejected the request. See server console."), so the user can tell a key problem from a parameter problem.

## Part B: Step 8, hear it, then play it

### Goal
The player hears exactly what a fill should sound like before playing, can alternate "app plays, I play" until it matches, and can compare their take with the correct one by ear. They can also record a fill they hear elsewhere (a video, a song) by playing it in, and turn it into a lesson.

### 1. Drum sound engine
- Create `src/sound/` with synthesized drum voices using Web Audio only (no sample files, so no licensing issues): kick (sine with fast pitch drop), snare (noise burst plus tone body), hi-hat closed and open (high-passed noise, short and long decay), hi-hat pedal (very short), toms 1 to 3 (pitched sines with pitch drop, descending pitch), crash and ride (band-passed noise, long decay; ride bell brighter and shorter), rim and cross-stick (short click). Velocity controls loudness and slightly the brightness.
- Schedule every sound on the AudioContext clock at exact times, using the same click times and clock conversion the metronome already uses. Never trigger lesson sounds with setTimeout.
- Its own volume control ("Drums"), separate from the click volume. Share the metronome's AudioContext.
- Keep the voice parameters in a pure, testable table; the Web Audio wiring stays thin.

### 2. Preview plays real drums
- The existing Preview button now plays the lesson with drum sounds (plus the pad flashes and highway), so the player hears the fill.

### 3. Listen-then-play mode
- New "Listen, then play" option: the app plays the focus range (or the whole lesson if there's no focus) with drum sounds, then the same section repeats silently and the player plays it. They alternate until stopped. Each player turn is graded on its own and works with the Trainer ladder (only player turns count).
- The highway shows the app's turn in a distinct style (for example outlined notes and a "Listen" label) and the player's turn normally ("Your turn" label).
- Timing must stay on the one metronome grid: the app's turn and the player's turn are consecutive sections of the same click timeline.

### 4. Guide track
- A "Guide drums" toggle that plays the correct drums quietly while the player plays along (useful at first, then turned off). Grading is unaffected.

### 5. Hit sounds for the keyboard
- When playing on the keyboard, play the drum sound for each hit, scheduled immediately, behind a "Hit sounds" toggle (default on for keyboard, off for MIDI, because the Roland module makes its own sound).

### 6. Compare replay
- After any graded pass, a "Compare" button plays: the correct version, a short gap, then the player's own hits exactly as played (real timing, real pads), both with drum sounds. The highway replays alongside. Option to play them at the same time, panned left (correct) and right (yours), to hear flams and drift.
- The player's recorded hits come from the existing InputManager recording, so no new capture code is needed.

### 7. Record a fill
- New "Record" mode: choose bars (1 to 4), BPM, and grid (16ths or triplets). After a count-in, it records hits against the metronome.
- Quantize each hit to the nearest grid step (pure, unit-tested function), merging duplicate hits on the same pad and step. Show the result in the lesson text format for editing, with a live highway preview and a "Play it back" button using the drum engine.
- "Save as lesson" creates a custom fill (category "fill", focus range covering the recorded bars). Store custom lessons in localStorage (wrap every read and write in try/catch so the app still works if storage is blocked). Custom lessons appear in the picker under "My fills" and can be deleted.
- Purpose: the player watches a fill on YouTube or Instagram, slows down with the app's 50% option, plays it in, fixes the text if needed, then learns it with the Trainer. The app never downloads or processes video.

### Unit tests
- Drum voice table: every pad has a voice; velocity scaling.
- Sound scheduling: lesson notes map to exact AudioContext times via the existing clock conversion (fake AudioContext, assert scheduled `start(when)` values).
- Listen-then-play: app turns and player turns alternate on consecutive sections; only player turns are graded and fed to the ladder.
- Compare: correct and player timelines start at the same relative time; player hits keep their real offsets.
- Quantize: hits snap to the nearest step, duplicates merge, triplet grid works, a hit exactly between two steps goes to the later one (deterministic).
- Record round trip: a scripted recorded fill → quantize → text → parse gives back the same notes.
- Custom lesson storage: save, load, delete, and graceful behavior when localStorage throws.

## Done means
Tests, typecheck, and build pass. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome (sound can't be heard there, so verify scheduling through state or logs, not by ear). Save a screenshot of listen-then-play during "Your turn" as `docs/steps/step-8-listen.png`. Then append a `## Result` section covering both parts, including clearly what the user must check by ear.

## Result

### Part A: Step 7b
1. **The coach no longer contradicts itself.** When the report has problem spots, `nextExercise` drills the worst one first, in every case (learned or not), with a new `spotDrill()`: "Loop just beats 3 and 4 of bar 2 at 55 BPM until Tom 2 is clean 3 times in a row, then try the full fill." A spot on the landing reads "beats 3 and 4 of bar 2 into the 1 of bar 3". The next lesson is suggested only when there are no spots. A learned fill with spots gets "Fill learned at 65 BPM. One spot to clean up." (or "Two spots"). The report gained `bar` and `beat` on each problem spot and `bar` on the fill. The Claude system prompt has the same rules. Tests: learned with a spot and without, a landing spot, and a spot outranking a rushing fix.
2. **No repetition.** The wentWell item "You learned it at N BPM" is gone, since the headline says it. A test checks that no wentWell item mentions "learn", is part of the headline, or repeats the headline's "at N BPM".
3. **Chip colors follow the ladder.** `passVerdict()` in `ladder.ts` is now the one place that decides clean, almost or rough, and both the ladder and the chips use it. Chips are green (clean), gray (almost) or red (rough). The session best is marked with ★ instead of a color. Outside the Trainer, the chips use the default thresholds (90/70). Tests: 90% at a 90% threshold is clean for both the ladder and the chip.
4. **Claude path.** The claude-api reference says `claude-haiku-5-5` supports `output_config.effort` (low to max) and `output_config.format` json_schema, so the request shape should be valid, but **this is still not tested with a real key.** API failures are now sorted by status: 400, 404 and 422 → `api-rejected` (a parameter or model problem); 401 and 403 → `bad-key`; everything else → `api-error`. The server logs `[coach] Claude call failed (HTTP 400): <API message>` and returns the API's message as `detail`. The UI shows the reason next to the heading ("Claude coach unavailable: API rejected the request. See server console.") and adds "API said: …" in the note. Tested with the SDK's real `APIError.generate`, and in the browser with a stubbed response.

### Part B: Step 8
- **`src/sound/`.**
  - `voices.ts` is a pure voice table, one voice per pad, built from tone layers (pitch glide) and noise layers (filter). Velocity sets loudness (a curve) and, slightly, the filter brightness.
  - `DrumKit.ts` is the thin Web Audio wrapper. It uses the metronome's AudioContext (new `metronome.getAudioContext()`) and has its own "Drums" volume. Every sound is booked with `start(when)`. `cancelScheduled()` silences sounds booked for the future when you press Stop.
  - `LessonSounds.ts` is fed from `metronome.onClick` and books each note at its click's own `audioTime`, so drums use the metronome's lookahead and clock. No timers anywhere.
- **Preview** plays the lesson as drums.
- **Listen, then play** is a checkbox that forces Loop on (shown locked).
  - It plays `sectionLesson()`: the whole bars that hold the focus, so for Around the toms that's bars 2 and 3 (the lead-in, the fill and the landing). Turns stay on the bar grid, back to back on one click timeline.
  - `turnPlan()`: even passes are the app's turn, odd passes are the player's. Only player turns reach the grader (`gradedNotesOnly`), the chips and the ladder. Trainer tempo changes land on the next listen turn, so you hear the new tempo before you play it.
  - The highway draws listen notes as blue outlines with a "Listen" label, and player turns normally with "Your turn". A corner banner, the bar label ("Your turn · Bar 1 of 2") and the status line follow the turn. Pads flash during listen turns.
  - The "graded" label now sits at the end of the shaded range, so it doesn't overlap the turn label.
- **Guide drums** is a checkbox that plays the correct drums at 0.3 gain on graded passes. It can be toggled mid-run and takes effect within 100 ms. Grading is unchanged.
- **Hit sounds** is a select: "Keyboard only" (the default, which includes scripted test hits), "Keyboard and MIDI", or "Off". The sound plays at `ctx.currentTime`.
- **Compare.** After a run, the chips are clickable to pick a pass (the default is the last one).
  - "Compare" plays the correct notes, an 800 ms gap, then your hits from the InputManager recording, at their real times, pads and velocities. "Both at once" pans the correct version left (-0.8) and yours right (+0.8).
  - The highway replays on the same timeline: correct outlined, yours with grades and hit ticks.
  - Pure parts are in `src/compare/compare.ts`.
- **Record a fill.** A panel with bars 1–4, a BPM and a grid (16ths or triplets).
  - After the count-in, hits are captured while the highway shows the full kit's lanes. When the bars end, `quantizeHits()` snaps each hit to the nearest step (an exact half goes to the later step) and merges duplicates, keeping an accent if any of them was 110 or harder. `notesToText()` writes the result in kit order.
  - The text is editable, with parse errors shown and a static highway preview. "Play it back" plays it with the drums.
  - "Save as lesson" makes a fill whose focus covers every recorded bar. `CustomLessonStore` keeps it in localStorage, and every access is wrapped in try/catch: if storage is blocked, it works in memory and says the fill won't survive a reload. Saved fills appear under "My fills". Delete takes two clicks; there's no browser dialog.

### Tests
**322 pass** (up from 280). Typecheck and build pass, and `dist` still has no SDK code or key. New tests:
- **Voices:** every pad has a voice, the kit's character, and velocity scaling.
- **DrumKit:** exact `start(when)`, panning, and cancelling only future sounds.
- **LessonSounds**, with the real Metronome on a fake AudioContext: every drum's `start(when)` equals its click's `audioTime`, and that click's performance-clock time is the expected note's graded time. Notes are booked within the lookahead and never during the count-in, accents play at 127, and listen turns get full drums, silence or the guide.
- **Turns:** sections are consecutive and alternate, only player turns are graded and reach the TrainerSession, and tempo-change bars land on listen turns.
- **Compare:** one relative clock, real offsets kept (a flam 4 ms apart survives), the gap, together mode, and the replay grid and result move.
- **Quantize:** nearest step, ties going later (16ths and float triplets), merging, triplets, and dropping hits outside the bars.
- **Round trips:** a scripted 2-bar fill → quantize → text → parse → same notes, for 16ths and triplets.
- **Storage:** save, load after a "reload", delete, a bad text rejected before storing, storage that throws, is null or whose getter throws, damaged entries, and unique ids.
- **Part A:** the tests listed above.

### Checked in headless Chromium
My own Playwright headless shell with `--mute-audio`, never your Chrome; 32 of 32 checks pass. Nothing was heard, so everything was checked by recording what was booked and when:
- **Hit sounds:** a key press plays immediately; "Off" silences it.
- **Preview** (rock beat at 160): all 16 notes are booked as drums, each exactly at a metronome click's `audioTime`, none in the count-in, booked 78–85 ms ahead.
- **Listen, then play** (Around the toms at 90 BPM, with scripted player hits):
  - Passes 0 and 2 played all 16 section notes at full level.
  - Pass 1 was silent, and pass 3 played the quiet guide after I turned it on during pass 2.
  - Every lesson drum sat exactly on a click.
  - Only passes 1 and 3 were graded: pass 1 at 100%, pass 3 with one wrong pad (Tom 2 played as Tom 3).
  - The chips were green for both (100% and 90%).
  - The banner and status changed with the turn.
- **Compare:** 16 correct notes and 16 of your hits. Your hits landed at their recorded offsets after the pass and the 800 ms gap, with a 0.0000 ms error. The labels read "Correct" and "Yours", and together mode panned -0.8 and +0.8.
- **Coach (stubbed `api-rejected`):** the label and the "API said" note show.
- **Record:** a 1-bar fill at 100 BPM played with ±9 to 34 ms of jitter and a double tom hit came out exactly as played, 14 notes. A bad edit showed the parse error, "Play it back" played 14 drums, and the saved fill appeared under My fills, survived a reload, and was deleted with the two clicks.
- **Console:** only the existing headless "Web MIDI permission" warning.
- **Screenshot:** `docs/steps/step-8-listen.png` shows "Your turn" mid-fill, with green graded notes, hit ticks and the banner.

### What you must check by ear (none of this could be heard here)
- **The drum voices themselves:** whether the kick, snare, hi-hats, toms, cymbals, ride and bell sound like drums and are balanced against each other and the click. Their levels and decays in `src/sound/voices.ts` are first guesses.
- **That the drums sit exactly on the click** in Preview and Listen turns. They are booked on the same AudioContext time, so they should.
- **That the guide level (0.3) is quiet enough** to play over but still useful.
- **Hit-sound latency on the keyboard.** It is played at `currentTime`, so it carries the output latency, about 10 to 40 ms. Tell me if it feels late.
- **Compare:** whether the 800 ms gap feels right, and whether left and right panning in "Both at once" makes a flam or drift easy to hear.
- **Velocity feel:** Shift (127) against normal (90) on the keyboard. With the kit, after Oct 25, check MIDI velocities through "Keyboard and MIDI" hit sounds; the Roland module plays its own sounds by default.

### Open issues and notes
- **The Claude path is still untested with a real key** (see A4). If it fails on a parameter, the UI now says so, and the server console has the API's own message.
- **In Listen mode the bars are numbered within the section,** so Around the toms' fill shows as "bar 1". The bar label, problem spots and coach all use that same numbering, so they agree with what's on screen, but not with the full lesson's bar 2.
- **A custom fill gets the coach's "next lesson" text for the last built-in fill** ("That's the hardest fill here…"), because custom fills aren't part of the difficulty order.
- **The record preview on the highway stands still** and shows only the first ~1.5 s; the highway scale is fixed. "Play it back" scrolls through the whole fill.
- **Compare replays the whole graded pass** (3 bars for a normal fill run), with no click under it.
- **Browser check setup:** the cached Playwright wanted a newer headless shell, so I pointed it at the installed one (`chromium_headless_shell-1234`), still with `--mute-audio`. The check script is in my scratchpad, not the repo.
- **CLAUDE.md's build order still lists step 8 as not done.** I left it for you. Nothing is committed.
