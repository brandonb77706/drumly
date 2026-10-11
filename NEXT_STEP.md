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
