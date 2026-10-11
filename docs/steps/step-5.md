# Next step: Step 5, the note highway (plus your first fills)

Read CLAUDE.md first. Steps 3b and 4 were reviewed: 131 tests, typecheck, and build pass. The reviewer agreed with the consistency tie-breaker in `match.ts`: the original spec (minimize total offset) was wrong, and the comment explains why. The reviewer also confirmed the matcher handles a gradually rushing 16th fill, a stray double hit, and a wrong tom in a tom fill. The previous step file is archived in `docs/steps/step-3b-4.md`.

## Goal
Show the player what to play and when, before they play it, and show how each hit landed. This is what makes learning a new beat or fill possible without already knowing it.

## Highway view
Create `src/highway/` with a canvas-based renderer.
- One horizontal lane per pad used by the current lesson (not all 14 pads), ordered like a kit: crash, hi-hat, ride, tom1, tom2, snare, tom3, kick, hi-hat pedal. Pad labels on the left.
- Notes scroll right to left toward a fixed "now" line about 25% from the left edge.
- Show about 2 seconds of upcoming notes. Scroll speed is pixels per millisecond, so faster tempos look denser, not faster.
- Bar lines and beat lines drawn from the metronome's click times, with bar lines bolder.
- Count-in clicks shown as faint markers so the player sees when the lesson starts.
- Notes with accents (velocity above a threshold, if the lesson defines it) drawn larger.

## Feedback on the highway
- When a note is graded, recolor it: green perfect, light green good, yellow early or late, orange wrong pad, red missed.
- Draw the actual hit as a small tick mark at its real time, so early and late is visible as a gap from the note.
- Extra hits appear as a gray tick in that pad's lane.
- Listen to LiveGrader's "revised" events so a note that gets re-matched updates its color.
- Graded notes keep scrolling left past the now line so the player can glance back at what just happened.

## Rendering rules
- Drive drawing with requestAnimationFrame. Position is computed from `performance.now()` minus the note's time, never by moving things a fixed amount each frame. This keeps the highway in sync with the audio even when frames drop.
- Handle devicePixelRatio so it's sharp on a Retina screen, and resize with the window.
- Keep a pure function `noteToX(noteTime, now, layout)` and `laneForPad(pad, lanes)` with unit tests. Canvas code stays thin.
- Don't allocate new objects per note per frame. Precompute what can be precomputed when a lesson starts.

## Practice screen changes
- The highway is the main element of the practice view, above the pass summary.
- Add a "Preview" button that plays the lesson with the metronome and no grading, and flashes the pad tiles on each note, so the player can see and hear it once before trying.
- Add a slow-down control: 50%, 75%, 100% of the lesson's default BPM.
- Add a click mode control with three options: "Click on" (default), "Count-in only" (click plays during the count-in, then goes silent), and "Muted". Muting must only change the audio gain. The metronome keeps scheduling clicks and grading keeps using the same click times, so the player is graded against the same tempo grid without hearing it. Remember the choice for the page session.

## First fills
The lesson format already supports fills, so add two now, so they can be tried on the highway:
1. "Snare 16ths fill": 1 bar of the 8th-note rock beat, then 1 bar where beats 1 to 3 are the beat and beat 4 is four 16th snares, ending on a crash and kick on beat 1 of the next bar (make the lesson 3 bars so the landing is included).
2. "Around the toms": 1 bar of beat, then a 16th-note fill on beat 3 and 4 going snare, snare, tom1, tom1, tom2, tom2, tom3, tom3, landing on crash plus kick.
Add a `category: 'beat' | 'fill'` field to lessons and group the picker by category.

## Unit tests
- `noteToX`: a note at the now time sits on the now line, future notes are to the right by exactly speed x time, past notes to the left.
- Lanes: only pads used by the lesson, in kit order.
- Each new fill parses and has the right note count, and a scripted perfect run grades 100%.
- A scripted run of the toms fill with one tom played on the wrong drum grades exactly one `wrongPad`.
- Slow-down: expected notes at 50% are spaced exactly twice as far apart, using click times.
- Click mode: in "Muted" and "Count-in only", clicks are still scheduled with identical times, and a scripted perfect run still grades 100%. In "Count-in only", gain is audible for count-in clicks and zero after.

## Done means
Tests, typecheck, and build pass. Then append a `## Result` section to this file: what was built, test counts, what you checked in headless Chrome (take a screenshot of the highway mid-lesson and save it as `docs/steps/step-5-highway.png`), and anything untested or uncertain.

## Result

### What was built
- **`src/highway/`**
  - `layout.ts` is pure. It has `KIT_ORDER`, `lanesForLesson`, `laneForPad` (falls back to an equivalent pad's lane, so an open hi-hat lands in the closed hi-hat lane when any hi-hat counts), `computeLayout`, and `noteToX`. The now line sits at 25% of the width. Scroll speed is fixed so that 2 s fits to the right of it, which means tempo changes density, not speed.
  - `model.ts` is pure. It holds note, grid-line and hit-tick records, each allocated once.
    - It re-reads `metronome.getGrid` every 200 ms, not every frame. Records are updated in place by note id or click index, so a clock-reference shift or a BPM change moves notes that are already on screen.
    - Grader `hit` / `revised` / `missed` events recolor notes. A revised hit frees its old note only if that hit still owns it.
    - When a run ends, `syncResults` repaints from the final batch grade, so the highway always agrees with the summary.
  - `HighwayRenderer.ts` is the thin canvas layer.
    - It is driven by rAF, and x is computed from `now − note.time`.
    - It sizes for devicePixelRatio and resizes with a ResizeObserver.
    - Lanes have labels in a gutter.
    - Bar lines are bold, beat lines thin, and count-in clicks are faint markers.
    - Accented notes are larger and ringed.
    - Hit ticks are white for matched hits and gray for extras.
    - Extras on a pad with no lane go in a slim "other" strip.
    - Colors: green for perfect, light green for good, yellow for early or late, orange for wrong pad, red for missed.
    - After a run the picture freezes, so you can look back at it.
- **Practice screen**
  - The highway sits under the lesson header.
  - **Preview** plays one pass with the metronome, ungraded, and flashes the lesson pad chips and pad tiles as each note reaches the now line.
  - **Speed** offers 50, 75 and 100%. The BPM is not rounded (75% of 85 is 63.75), so spacing is exact.
  - **Click mode** offers "Click on", "Count-in only" and "Muted". It is stored in `sessionStorage`. In the metronome it is only a per-click gain multiplier (`clickGain`), so scheduling, click times and grading are unchanged.
  - The pattern text moved into a collapsible "Pattern as text".
- **Fills** live in `src/lessons/fills.ts`. Both are 16th-grid, 3-bar lessons, and the bar-3 landing has an accented crash plus a kick.
  - **Snare 16ths fill**: 27 notes.
  - **Around the toms**: 28 notes. I read "1 bar of beat, then a fill on beats 3 and 4" as bar 1 being a full groove, and bar 2 being groove on beats 1–2 and the fill on beats 3–4, with no kick on 3.
  - Lessons now have `category: 'beat' | 'fill'`, defaulting to `'beat'` in `lessonFromText`. The picker groups them with `<optgroup>`.

### Tests
178 tests pass, up from 131. Typecheck and build pass.

New tests:
- `noteToX` (now line, exact speed × time, past to the left) and the layout.
- Kit-order lanes, using only the lesson's pads, and the `laneForPad` fallback.
- The model: grid refresh rate, in-place moves on a clock shift, pruning, verdict colors, revisions, misses, wrong-pad ticks, `syncResults` against a batch grade, `takePassed`, and loop passes.
- Both fills: note counts, the landing, and a perfect TestSource + LiveGrader run at 100%.
- The toms fill with the first tom 2 played on tom 3 gives exactly one `wrongPad`, at 27/28.
- At 50%, every lesson's note gaps are exactly 2× (and 4/3 at 75%), computed from scheduler click times.
- Click mode, on the fake AudioContext:
  - Muted and count-in-only runs have identical oscillator start times and click times to an audible run, and a perfect run on their grid grades 100%.
  - Count-in-only has gain > 0 on the 4 count-in clicks and 0 after.
  - Muted has every click at 0.
  - A mid-run change applies from the next booked click.

### Checked in headless Chromium
I used Playwright with `--mute-audio` and DPR 2, the real metronome, Web Audio and rAF, with hits scripted through TestSource on the real click times.
- **Around the toms with one wrong tom**: 96.4%, 27/28, with 1 wrong pad. The highway showed the wrong-pad note in orange with its tick, and the rest perfect. The screenshot is `docs/steps/step-5-highway.png`, taken mid-fill.
- **Preview of the snare fill**: 27 chip flashes for 27 notes, no summary, and the metronome stopped by itself afterward. The Preview button was disabled while playing.
- **50% on the 8th-note beat**: 45 BPM. The first-to-last note span was 10 000 ms, against 5 000 ms at 100%. With the click muted (the choice survived a page reload), a perfect run graded 100%.
- **Count-in only, with 2 notes dropped**: 91.7%, 2 missed. The highway showed exactly those 2 notes in red.
- **Canvas sizing**: the backing store was exactly 2× the CSS content box, before and after a viewport resize. My first run found a 2 px mismatch, because I had used `getBoundingClientRect`, which includes the border. That is fixed by using `clientWidth`/`clientHeight`.
- **Console**: no errors. The only warnings were "MIDI permission not granted", which is expected in headless mode.

### Untested or uncertain
- **Visual quality while moving.** I didn't check how smooth the scrolling looks, or how it behaves under real frame drops, beyond the math. I didn't look at a Retina display or at a real person playing.
- **Early/late colors and extra ticks were not exercised in the browser.** Unit tests cover them.
- **A click-mode change mid-run can lag by up to the 100 ms lookahead.** Clicks already booked keep their old gain.
- **Notes stay visible for only about 0.6 s after the now line at 1200 px width, less on narrow screens.** That's because the line sits at 25%. If glancing back needs more room, move the now line or shorten the 2 s look-ahead.
- **Pending notes that have passed the now line stay neutral** until they are reported missed, which happens about 150 ms after their time.
- **The status line still says "Count-in… then play." for the whole run.** That's existing behavior.
- **Not tested here:** the MIDI kit, and timing thresholds against real hits (not before about Oct 25).
- **Nothing is committed.**
