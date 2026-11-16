# Padel Americano Organizer
Requirements: SPEC.md + SPEC_v2.md. Read only the sections named in the prompt. Work on a branch per milestone.

## Rules
- Vanilla JS/HTML/CSS. No frameworks, no CDN, no npm dependencies (Node built-ins only).
- src/scheduler.js and src/ranking.js: pure functions, no DOM, seeded RNG only.
- Source in src/, output ONE self-contained file dist/padel.html via `node build.js`.
- Targeted edits only. Never rewrite whole files. Only read files relevant to the task.
- Do not add features that are not in SPEC.md or the current prompt. Unclear? Ask or state your assumption.
- Do not do more than the current milestone asks.
- UI text English only.
- Verify with `node test/*.test.js` and `node build.js` only.
- NO headless-browser screenshots or smoke scripts unless I ask.
- If a command is interrupted, rerun only that command.
- Layout: player names never wrap inside a word (nowrap + fluid font). Projector-first.
- Commit after each milestone with message "M<n>: <summary>", then stop and wait.
- Replies max 8 lines: what changed, how I verify, open questions.

## Commands
- node build.js
- node test/scheduler.test.js
- node test/ranking.test.js