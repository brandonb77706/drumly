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

## Done means
Tests, typecheck, and build pass. Then append a `## Result` section to this file: what was built, test counts, what you checked in headless Chrome (take a screenshot of the highway mid-lesson and save it as `docs/steps/step-5-highway.png`), and anything untested or uncertain.
