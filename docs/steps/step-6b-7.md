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

## Result

### Part A: Step 6b
1. **Problem spots are less jumpy.** `ProblemTracker` now counts `offPasses`: passes where a note was missed, on the wrong pad, early or late, counted once per pass. A note is listed only if it was off in at least 2 passes and in at least a third of the passes it was graded in (`MIN_OFF_PASSES`, `MIN_OFF_SHARE`). The 20 ms strictness is unchanged. Highway rings use the same list, and the empty list reads "No problem spots yet. Keep going."
2. **Pass chips** now read "Pass 3 · 65 BPM · 90%". The pass that triggered a speed-up gets a green ↑, a slow-down gets an amber ↓, and each arrow has a tooltip. Chips show the tempo for plain runs too.
3. **Loop checkbox.** While Trainer is on, Loop shows checked and is disabled. Turning Trainer off restores whatever the player had chosen.
4. **Status line.** Once bar 1 starts, the count-in text becomes "Looping until you press Stop." (or empty for a single run). The trainer message becomes "Only the shaded fill is graded."
5. **Numbers.** The stat tiles and the per-pad table use whole ms. Means use `formatOffset` ("-20 ms", "0 ms") and spreads read "9 ms". `formatMsStat` is gone.

### Part B: Step 7, the session coach
- **`src/coach/report.ts`**: `buildSessionReport(session)` is pure. It takes `{ lesson, passes: [{ bpm, result, change? }], trainer? }`, so plain runs and trainer runs both work. It reports:
  - the lesson, its category and the next lesson in difficulty order
  - the number of passes, the BPM range, and the trainer's start, target, final BPM and whether the fill was learned
  - accuracy over the fill (or the whole lesson), with per-pass BPM and accuracy and a first-half vs. second-half trend (±5 points)
  - whole-lesson timing, fill and groove timing (mean, spread, rushing/dragging/on time beyond 10 ms), and per-pad stats
  - up to 3 qualified problem spots, labeled with drummer counting and the pad played instead
  - no hands, since MIDI can't tell left from right.

  A typical 6-pass trainer report is about 1,600 characters of JSON, roughly 450 tokens.
- **`src/coach/rules.ts`**: `ruleBasedCoaching(report)` returns `{ headline, wentWell[], fixThis[], nextExercise }`, with at most 2 fixes, most important first. Rules:
  - a repeated wrong pad on one note
  - a repeated miss
  - rushing or dragging the fill by more than 15 ms
  - a spread over 25 ms: drop 10 BPM and use "Count-in only"
  - a note that is repeatedly early or late
  - accuracy dropping at a steady tempo
  - a learned fill: move on to the next fill, or after the last fill, raise the target by 10 BPM
- **Claude coach.** `server/claudeCoach.ts` calls the Messages API through `@anthropic-ai/sdk` (0.133).
  - Model: `COACH_MODEL`, default `claude-haiku-5-5`, at low effort, with a JSON-schema output format and the teacher system prompt (claims only from the report's numbers, under 120 words).
  - The reply is checked on the server: exact keys, non-empty strings, at most 4 items per list.
  - If there's no key, the call times out (10 s, request aborted), the API errors, the model refuses or is cut off, or the JSON is invalid or the wrong shape, the rule-based coaching comes back with `source: 'rules'` and a reason.
  - `server/coachPlugin.ts` is a Vite dev-server middleware for `POST /api/coach`. It reads the key from `.env` only, not from the shell environment, and loads the route on the first request through `ssrLoadModule`.
  - `.env` is git-ignored (`git check-ignore .env` prints `.env`), and `.env.example` is added. The browser bundle contains no SDK code; the only "anthropic" match in `dist` is the help text that mentions `ANTHROPIC_API_KEY`.
- **UI.** When a session ends, a Coach panel shows the quick tips straight away. "Get coaching" asks the server. The heading says "Coach" (from Claude) or "Quick tips" (rule-based, works offline), and a plain-words note explains any fallback. Without a key the button changes to "Claude coach off" rather than offering a pointless retry. If the server isn't running (for example in a static build), the browser falls back to local rules.
- **Speech.** A `Speaker` interface with `silentSpeaker` and `browserSpeaker()` (`speechSynthesis`) sits behind a "Read it to me" checkbox. ElevenLabs can implement the same interface later.

### Tests
280 pass, up from 234. Typecheck and build pass, with no `.env` present. New or updated tests:
- **Problem spots:** off passes, the single-slip case (the screenshot's 35 ms-once lists nothing), the 2-pass and one-third boundaries (2 of 6 listed, 2 of 7 not), and re-ranked worst-3.
- **Report:** an improving session, a session that rushes the fill, a repeated wrong tom, a learned trainer session, a beat without a fill, an empty session, the size limit, and the trend math.
- **Rules:** every rule, including the thresholds and the 2-fix cap, plus an end-to-end scripted session.
- **Claude coach,** with the SDK mocked (`vi.mock`, no real calls): a valid response (and the request it sends), the `COACH_MODEL` override, a fenced JSON reply, invalid JSON, a wrong shape, a refusal or `max_tokens`, a timeout (and that the request is aborted), no key (the SDK is never called), and an API error.
- **Route:** the no-key response, 405 for other methods and 400 for bad bodies, and the route matching the browser's endpoint.
- **`.env` reader:** it ignores a key set only in the shell.
- **Browser client:** pass-through, server fallback, unreachable server, timeout. **Speech:** the speaker and the read-out text.

### Checked in headless Chromium
My own Playwright headless shell with `--mute-audio`, never your Chrome. Scripted trainer session on Around the toms, start 60 and target 65:
- **The hits:** the fill was scripted 18 ms early every pass, Tom 1 was 35 ms late once in pass 1, and from pass 3 on, Tom 2 on the 'e' of 4 was played as Tom 3.
- **Count-in and pass 1:** the count-in text cleared at bar 1. After pass 1 the list read "No problem spots yet. Keep going." and there were no rings: the single slip didn't count.
- **Pass chips:** "Pass 1 · 60 BPM · 100%", "Pass 2 · 60 BPM · 100% ↑", "Pass 3 · 65 BPM · 90%", "Pass 4 · 65 BPM · 90%". The fill was learned at 65.
- **Problem spots:** only "Tom 2 on the 'e' of beat 4 (bar 2): hit as Tom 3 twice".
- **Coach panel (Quick tips):** two fixes, the Tom 2 → Tom 3 one and "rushing into the fill (about 17 ms early)". The +35 ms slip pulls the mean in from -18. Next time: "Full-bar tom run".
- **Get coaching:** returned HTTP 200 `{ source: 'rules', reason: 'no-key' }`, and the panel showed the no-key note.
- **Loop checkbox:** checked and disabled with Trainer on; the player's choice came back with it off.
- **Console:** no errors, only the existing headless "Web MIDI permission" warning.
- **Screenshot:** `docs/steps/step-7-coach.png` shows the chips, problem spots and the Coach panel.

### Untested or open
- **The Claude path was not tested with a real key.** There is no `.env`, and I didn't ask for or handle a key. It is covered only by the mocked tests, so things like the exact `output_config` support on `claude-haiku-5-5` are unverified until you add `.env` and press "Get coaching". Any API error still falls back to quick tips, and the server console logs the error message.
- **The coach route exists only on `npm run dev`,** not `vite preview` or a static build. There the panel falls back to local quick tips.
- **"Read it to me" wasn't heard.** The browser is muted and headless speech isn't meaningful. The speaker logic is unit-tested with a fake.
- **Untuned thresholds:** rushing beyond 15 ms, loose timing over 25 ms, a tendency beyond 10 ms, and a trend of ±5 points. Tune them with the kit after about Oct 25. The 15 ms rush rule is near the keyboard's natural jitter.
- **The "getting worse" fix is skipped when the tempo rose during the session,** since lower accuracy at a higher tempo is expected.
- **Dependencies:** `@anthropic-ai/sdk` was added, plus `@types/node` (dev). `tsconfig` gains `allowImportingTsExtensions` so `vite.config.ts` can import the plugin with its `.ts` extension, which keeps Vite's config loader quiet.
- **Nothing is committed.**
