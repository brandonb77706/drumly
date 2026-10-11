# Next step: 10b (progress polish, exact pass summaries, README)

Read CLAUDE.md first. Steps 9b and 10 were reviewed: 427 tests, typecheck, and build pass with no `.env`, the bundle has no SDK or key, and the port is pinned to 5173. The reviewer looked at `docs/steps/step-10-progress.png`. Thanks for correcting the reviewer: looped runs were using live results for the coach and Compare, and you fixed it. The previous step file is archived in `docs/steps/step-9b-10.md`.

Step 11 (Kit day) has to wait until the Roland kit is back around Oct 25. This step is the last one before that.

## 1. Exact per-pass summaries in loops
The summary shown at the end of each looped pass is still live. A pass is only a few bars, so grading it in full is cheap. At the end of each pass, run the batch grader over just that pass's notes and hits (with the matching window extended by `windowMs` on both edges so boundary hits are handled), and use that for the pass summary, the pass chip, the ladder decision, personal bests, and the saved session. Live colors during play can stay settled/live. Add a test where a sloppy looped run gives a pass summary identical to a batch grade of that pass.

## 2. Progress chart x-axis
In the screenshot, every x-axis label reads "Oct 11", because all sessions were the same day. Label points by date when sessions span multiple days, and by time ("1:26 PM") when they're all on one day. Show at most about 6 labels, so they never overlap. Hovering (or tapping) a point shows that session's date, time, accuracy, and BPM. Keep the label logic in a pure tested function.

## 3. Remember settings between page loads
Settings (click mode, volumes, hit sounds, guide drums, speed, last lesson, trainer settings, Progress tab state) reset on reload. Save them in localStorage as a per-browser convenience, wrapped in try/catch so a blocked storage doesn't break anything. Include them in the existing export file as now. Test load, save, and a corrupted or missing value falling back to defaults.

## 4. README for the portfolio
Write `README.md` for someone seeing the project on GitHub:
- one-paragraph pitch and a screenshot (use the existing step screenshots in `docs/steps/`)
- feature list in plain language
- how it works: input layer, Web Audio lookahead scheduling and clock alignment, the order-preserving alignment grader (why greedy failed), the tempo ladder, the coach with rule-based fallback
- tech stack, how to run (`npm install`, `npm run dev`, Chrome or Edge for MIDI), optional `.env` for the Claude features
- testing: how many tests and what the browser checks cover
- privacy note: history stays in the browser; the API key stays in `.env` on the local server
Keep it honest: say the real kit hasn't been tested yet and thresholds will be tuned on Kit day.

## Done means
Tests, typecheck, and build pass with no `.env`. Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome, and never the user's dev server on 5173. Append a `## Result` section.
