# Padel Americano Organizer
Requirements are in SPEC.md. Read it before starting any task.

## Rules
- Vanilla JS/HTML/CSS only. No frameworks, no CDN, no npm dependencies (Node built-ins only).
- src/scheduler.js = pure functions, no DOM, seeded RNG only (no bare Math.random).
- Source in src/, final output is ONE self-contained file: dist/padel.html (via `node build.js`).
- Never rewrite whole files. Use targeted edits. Only read files relevant to the task.
- Do not add features that are not in SPEC.md. If something is unclear: ask, or state your assumption.
- UI text is English only.
- Before saying "done": run `node test/scheduler.test.js` and `node build.js`.
- Commit after each milestone.
- Keep replies short: max 8 lines (what changed, how I verify it, open questions).

## Commands
- node build.js → dist/padel.html
- node test/scheduler.test.js