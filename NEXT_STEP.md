# Next step: 5b (highway polish), then Step 6 (fill trainer)

Read CLAUDE.md first. Step 5 was reviewed: 178 tests, typecheck, and build pass, and the reviewer looked at `docs/steps/step-5-highway.png`. The previous step file is archived in `docs/steps/step-5.md`. Your "Around the toms" reading (groove in bar 1, fill on beats 3 and 4 of bar 2) is correct.

Do part A first, then part B.

## Part A: Step 5b, fixes from the screenshot review

1. **Look-back is too short (you flagged it, confirmed in the screenshot).** The now line sits at about 17% of the canvas, so a just-graded note disappears almost immediately. Move the now line to about 35% of the lane width and show about 1.5 s ahead instead of 2 s. Players need to glance back at the fill they just played. Keep it configurable in the layout object and update the `noteToX` tests.
2. **Wrong-pad hits are drawn in the wrong lane.** The hit tick for a wrong-pad hit is drawn in the note's lane (Tom 2), but the player hit Tom 3. Keep the orange note in Tom 2, and draw the hit tick in the lane of the pad actually played (Tom 3), so the player sees where they went. If that pad has no lane, draw it in "other".
3. **Status text says "perfect -0.0".** Format offsets as whole ms with a sign: "+12 ms", "-8 ms", "0 ms", never "-0.0". For wrong-pad hits, say "on time" or "12 ms late" instead of "perfect", since "perfect" next to "wrong pad" reads as a contradiction. Add a unit-tested `formatOffset` helper.
4. **Stop button is unreadable.** Orange text on an orange background. Use dark text on the filled button and check the contrast of every button state (normal, hover, disabled).
5. **"other" lane is clipped** at the bottom of the canvas. Give it the same height as the other lanes, and only show it when an extra hit actually lands on a pad that has no lane.
6. **Lesson description vs. layout.** The "Around the toms" description says "One bar of beat, then 16ths on beats 3 and 4". Change it to "One bar of groove, then a bar with the fill on beats 3 and 4, landing on crash plus kick in bar 3", so it matches what's on the highway.

## Part B: Step 6, the fill trainer

### Goal
Learn a fill the way a drum teacher would teach it: start slow, loop it, speed up only once it's clean, and know exactly which notes in the fill are the problem.

### Tempo ladder (auto speed-up)
- New "Trainer" mode for any lesson (fills especially). Settings: start BPM (default 60% of the lesson's BPM), target BPM (default the lesson's BPM), step size (default +5 BPM), pass threshold (default 90% accuracy), and passes needed (default 2 clean passes in a row).
- The trainer loops the lesson. After each pass it decides: pass meets the threshold → count it; enough clean passes in a row → raise BPM by the step, never above the target; below 70% accuracy twice in a row → drop BPM by one step (never below start BPM).
- Show the current BPM, the ladder progress (for example "75 → 85 BPM, 1 of 2 clean passes"), and a short message on each change ("Clean! Speeding up to 80 BPM", "Slowing down to 70 BPM").
- Reaching the target BPM with the required clean passes ends the session with a "Fill learned at 85 BPM" message.
- The ladder's decision logic must be a pure function: `nextLadderState(state, passSummary, settings)`. Unit test it fully. BPM changes must take effect at a pass boundary (the next loop start), using the metronome's existing commit-at-beat logic so nothing double clicks.

### Grade only the fill
- Lessons get an optional `focus` range (start and end position, for example bar 2 beat 3 to bar 3 beat 1). The groove before it is still played and shown, but accuracy for the ladder and the summary's headline number only count notes inside the focus range. The full-lesson stats stay available below.
- Shade the focus range on the highway so the player sees which part is being graded.
- Set focus ranges on both existing fills.

### Problem spots
- Across all passes in a trainer session, track each note in the focus range: how often it was missed, wrong pad, early, or late, and its average offset.
- After the session (or on demand), show the 3 worst notes with plain-language labels like "Tom 2 on the 'e' of beat 4: late in 4 of 6 passes, about 35 ms late on average" and "Snare on beat 3: hit as Tom 1 twice".
- Name subdivisions in drummer counting: beat number, "e", "and", "a" for 16ths; "trip" and "let" for triplets. Write a pure unit-tested `positionLabel(bar, beat, subdivision, subdivisionsPerBeat)` helper.
- Highlight those notes on the highway with a ring during the next pass.

### More fills
Add 4 more so there's a ladder of difficulty, each with a focus range:
1. "8th-note snare fill": beat 4 as two 8th snares, landing on crash plus kick. (Easiest)
2. "Snare to floor tom": 16ths on beat 4: snare, snare, tom3, tom3.
3. "Triplet fill": beat 4 as a triplet on snare, tom1, tom2, landing on crash plus kick (lesson uses a triplet grid).
4. "Full-bar tom run": a whole bar of 16ths moving snare (4), tom1 (4), tom2 (4), tom3 (4), landing on crash plus kick.
Sort fills in the picker from easiest to hardest.

### Unit tests
- Ladder: speeds up after the required clean passes, never exceeds target, slows down after two bad passes, never goes below start, finishes at target.
- Focus range: only notes inside it count toward headline accuracy; notes outside it are still graded and shown.
- Problem spots: correct counts and averages across passes, worst 3 ranked correctly, ties deterministic.
- `positionLabel`: beats, "e", "and", "a", triplet labels.
- Each new fill parses, has the right note count, and grades 100% on a scripted perfect run.
- A scripted trainer session: 2 perfect passes at 60 BPM moves to 65, then a run with one tom consistently late shows that tom as the top problem spot.

## Done means
Tests, typecheck, and build pass. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome. Save a screenshot of the trainer mid-session with the focus range shaded and a problem-spot ring visible as `docs/steps/step-6-trainer.png`. Then append a `## Result` section to this file covering both parts.
