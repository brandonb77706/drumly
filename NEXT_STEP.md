# Next step: 6b (trainer polish), then Step 7 (session coach)

Read CLAUDE.md first. Steps 5b and 6 were reviewed: 234 tests, typecheck, and build pass, and the reviewer checked `nextLadderState` and `docs/steps/step-6-trainer.png`. The ladder, focus shading, and problem-spot ring all look right. The previous step file is archived in `docs/steps/step-5b-6.md`.

Do part A first, then part B.

## Part A: Step 6b, fixes from the trainer screenshot

1. **Problem spots are too jumpy (your "worth your judgment" point, decided).** In the screenshot, Tom 2 is the #1 problem after being 35 ms late once in 3 passes, while every pass scored 100%. One slip isn't a problem spot. Keep the 20 ms strictness, but only list a note when it was off (missed, wrong pad, early, or late) in at least 2 passes and in at least a third of the passes it was graded in. When nothing qualifies, show "No problem spots yet. Keep going." Rings on the highway follow the same rule. Update the problem-spot tests, including a single-slip case that lists nothing.
2. **Pass chips need the tempo.** "Pass 1: 100.0%" doesn't show that passes 1 and 2 were at 60 and pass 3 at 65. Change chips to "Pass 3 · 65 BPM · 100%". Mark the passes that triggered a speed-up or slow-down with a small arrow.
3. **Loop checkbox while Trainer is on.** Trainer always loops, so disable the Loop checkbox and show it as checked while Trainer is on.
4. **Stale status line.** "Count-in... then play. Looping until you press Stop." is still showing during pass 4. Clear the count-in text once bar 0 starts.
5. **Number formats in the per-pad table.** Mean and std dev show "0.0" while the rest of the app uses `formatOffset` ("+17 ms", "0 ms"). Use whole ms everywhere, with `formatOffset` for means.

## Part B: Step 7, the session coach

### Goal
After a session, give the player advice like a drum teacher would: what went well, the one or two things to fix, and a specific exercise for next time. It must work without an internet connection or API key (rule-based), and optionally use Claude for more natural coaching.

### 1. Session report (pure, no AI)
Create `src/coach/` with a pure `buildSessionReport(session)` that turns a finished practice or trainer session into a compact, structured summary. This is the single source of truth for both the rule-based coach and the AI coach:
- lesson title and category, BPM range used, number of passes, whether the fill was learned
- overall accuracy and accuracy trend across passes (improving, flat, or getting worse)
- mean offset (rushing or dragging) and consistency (std dev), overall and per pad
- timing tendency on the fill vs. the groove (for example "rushes the fill by 15 ms")
- the qualified problem spots from part A, with drummer-counting labels
- left vs. right hand is not known from MIDI, so do not guess hands

Keep the report small (a few hundred tokens as JSON) so it's cheap to send to the API. Unit test it with scripted sessions: a steadily improving session, a session that rushes the fill, and a session with a repeated wrong tom.

### 2. Rule-based coach (always available)
A pure `ruleBasedCoaching(report)` that returns `{ headline, wentWell[], fixThis[], nextExercise }` from simple rules, for example:
- mean offset on the fill below -15 ms → "You're rushing into the fill. Count '3 e and a' out loud and land the first tom on time."
- repeated wrong pad on one note → "Tom 2 on the 'e' of 4 keeps landing on Tom 3. Play just beats 3 and 4 slowly until your hand finds Tom 2."
- consistency worse than 25 ms → suggest dropping 10 BPM and using "Count-in only" click mode.
- fill learned → suggest the next fill in the difficulty order.
Cover each rule with a test. Keep the wording plain and short, like a teacher talking.

### 3. Claude coach (optional)
- The API key must never reach the browser or git. Add a tiny local server: a Vite dev-server middleware (or a small Node script started alongside `npm run dev`) with one route, `POST /api/coach`, that reads `ANTHROPIC_API_KEY` from a `.env` file and calls the Anthropic Messages API with the official `@anthropic-ai/sdk` package.
- Add `.env` to `.gitignore` and create `.env.example` with `ANTHROPIC_API_KEY=` and `COACH_MODEL=claude-haiku-5-5`. Make the model configurable through `COACH_MODEL`, defaulting to `claude-haiku-5-5` (fast and cheap for short coaching).
- The server sends the session report JSON plus a system prompt that makes Claude act as a friendly, direct drum teacher. It must base every claim on the report's numbers, never invent problems, keep it under 120 words, and return the same `{ headline, wentWell[], fixThis[], nextExercise }` shape as JSON. Validate the response shape on the server. If it's invalid, or the call fails, times out (10 s), or there's no key, return the rule-based coaching instead with a `source: 'rules'` flag.
- The UI shows a "Coach" panel after a session ends (and a "Get coaching" button), with the source labeled ("Coach" vs. "Quick tips") so the player knows which they got.
- Tests: mock the SDK. Cover valid response, invalid JSON, timeout, and no key falling back to rules. No real API calls in tests.

### 4. Hook for Jarvis later
Add a `speak(text)` interface with a no-op default implementation and a browser `speechSynthesis` implementation behind a "Read it to me" toggle. ElevenLabs (Jarvis voice) can plug into the same interface later. Don't add ElevenLabs now.

## Done means
Tests, typecheck, and build pass with no `.env` present (rule-based path). Browser checks use your own headless Chromium with `--mute-audio`, never the user's Chrome. Save a screenshot of the Coach panel after a scripted trainer session as `docs/steps/step-7-coach.png`. Confirm `.env` is git-ignored with `git check-ignore .env`. Then append a `## Result` section to this file covering both parts, including whether the Claude path was tested with a real key (only if the user has created `.env` themselves; never ask for or handle the key).
