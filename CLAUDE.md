# Drumly: drum practice coach

A browser app that listens to a Roland electronic drum kit over USB MIDI and coaches the player: grades each hit as right or wrong, measures timing in milliseconds, teaches beats, fills, and songs, and gives advice on where to improve.

The kit is unavailable until about Oct 25, 2026. Until then, build and test with the keyboard source and scripted TestSource hits. Never make a feature depend on having the kit.

## Stack
- TypeScript (strict), Vite, Vitest. No UI framework yet.
- `npm test`, `npm run typecheck`, `npm run build` must all pass before a step is called done.

## Architecture (keep these boundaries)
- `src/input/`: every hit source (keyboard, MIDI, test) produces the same `Hit` type through `InputManager`. Nothing downstream knows where a hit came from.
- `src/metronome/`: Web Audio click scheduling with a lookahead scheduler in a Web Worker. Click times are exposed on the performance.now() clock.
- Pure logic lives in its own files with unit tests (timing math, MIDI parsing, grading). Browser APIs stay in thin wrappers.

## Timing rules (most important)
- All hit and click times are milliseconds on the performance.now() clock.
- Hit times come from the event's own `timeStamp`, never from `performance.now()` inside a handler.
- Never use setTimeout or setInterval to produce sound or to judge timing.
- Never accumulate time by repeated addition. Compute `start + n * interval`.
- Keyboard tapping is naturally +/- 20 to 40 ms; don't tune thresholds against it. Tune them once the real kit is back.

## Build order
1. Input layer (keyboard, MIDI, test sources) - DONE
2. Web Audio metronome with clock alignment - DONE
3. Comparison engine: match hits to expected notes, grade pad and timing - DONE
4. First lessons (3 or 4 simple beats) graded live - DONE
5. Note highway display - DONE
6. Fills as lessons with auto tempo increase - DONE
7. Post-session analysis plus Claude API coaching (Jarvis voice optional) - DONE
8. Drum sounds, listen-then-play mode, compare replay, and record-a-fill - DONE
9. Import fills and songs: drum notation screenshots (Claude vision), MIDI files, section looping - DONE
10. Save sessions and chart progress over time - DONE
11. Kit day (when the Roland is back): pad map check, latency calibration, threshold tuning

## Working rules
- Before coding a step, explain the design and the "why" briefly.
- After building, run tests, typecheck, and build, and report honestly what passed, what failed, and what couldn't be tested without a browser or the kit.
- Browser testing must be silent and must not use the user's own browser. Do not test in the connected browser (the Claude in Chrome extension or the user's open Chrome window), because sound plays out loud on the user's speakers. Always launch your own headless Chromium with Playwright or Puppeteer and the `--mute-audio` flag, for example `chromium.launch({ headless: true, args: ['--mute-audio'] })`. Muting only cuts sound output: Web Audio scheduling, click times, and grading behave exactly the same. If an existing test script launches a browser without it, fix that script.
- Never add Claude (or any AI) as a commit author or co-author. No Co-Authored-By lines.
- Finished step files are archived in `docs/steps/`. The current task is always in `NEXT_STEP.md`. When it's done, add a short "Result" section at the bottom of that file summarizing what was built, test results, and any open issues, so the reviewer can read it.
