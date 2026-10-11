# Next step: Step 11, Kit day (do this only once the Roland kit is plugged in)

Read CLAUDE.md first. Step 10b was reviewed: 446 tests, typecheck, and build pass with no `.env`. The previous step file is archived in `docs/steps/step-10b.md`.

**Do not start this step until the user says the kit is connected.** If the kit isn't connected, stop and say so.

## Goal
Make the app accurate on the real kit: every pad maps correctly, the delay between hitting a pad and the app seeing it is measured and corrected, and the timing thresholds fit real drumming instead of keyboard taps.

## 1. Kit check screen
- A "Kit setup" view that shows the connected MIDI device name and asks the user to hit each pad in turn (kick, snare head, snare rim, hi-hat closed and open, pedal, each tom head and rim, crash edge and bow, ride bow, edge, and bell).
- For each prompt, record the MIDI note numbers that arrive. Show any note that doesn't map, or maps to the wrong pad, and let the user fix it with a dropdown.
- Save the result as a per-kit pad map (keyed by device name) in IndexedDB, used by `MidiSource` in place of the default `MIDI_NOTE_TO_PAD`. Include it in the export file.
- Log the raw MIDI messages seen (note, velocity, control changes like hi-hat pedal position) to a collapsible panel, so the user can paste them to the reviewer.

## 2. Latency calibration
- "Calibrate": play a click at 90 BPM for 16 beats and ask the user to hit the snare exactly with it. Ignore the first 4 hits, take the median offset of the rest (median, not mean, so one flub doesn't skew it), and show it with the spread.
- Explain in one line that this measures the combined delay of the speakers, the kit's MIDI, and the user's own feel.
- If the spread is over 30 ms, ask the user to redo it.
- Save the result as the latency offset (the existing setting), per device, and include it in the export. This fixes the open issue that the latency offset wasn't saved.
- Check the existing offset direction with a unit test: a player who is consistently 25 ms late in calibration should then grade around 0 ms on a perfect-feeling run.

## 3. Threshold tuning
- Add a "Timing feel" check: after calibration, the user plays the 8th-note rock beat at 90 BPM for 8 bars with the click. Report the spread per pad.
- Suggest perfect and good thresholds from the result (perfect about 1x their spread, good about 2x, clamped to sane ranges such as perfect 15 to 30 ms and good 30 to 60 ms), and let the user accept or keep the defaults. Same for the coach's "rushing" and "loose timing" limits, and the problem-spot strictness.
- Save accepted thresholds as user settings and include them in the export.

## 4. Real-input regression check
- Record one real 8-bar session and save its raw hits as a test fixture (`src/fixtures/kit-session.json`). Add a test that grades it and checks the result stays stable, so later changes can't silently break real-kit grading.

## Unit tests
- Calibration math: median offset, ignores warm-up hits, spread, redo when spread is too high.
- Pad map: per-device map overrides the default; unknown devices use the default; export and import round trip.
- Threshold suggestions: clamping, rounding, accept vs keep defaults.
- The real-session fixture grades the same every time.

## Done means
Tests, typecheck, and build pass. This step needs the user at the kit, so list exactly what the user did and what was measured (device name, latency offset, spread, suggested thresholds) in a `## Result` section.
