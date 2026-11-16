# Padel Americano Organizer — Spec v2 (additions to SPEC.md)

## Goals
Professional, reusable by other club staff, club-branded but with the club design strictly
separated from the core so a generic version needs only a new theme file.
Platform unchanged: one self-contained HTML file, localStorage + JSON export/import.
Hosted static page + PWA comes last (M11). Multi-device sync is out of scope (v3).
Design state shape so sync could be added later (all state in one serialisable object).

## A. Theme and strings separation
- Core has no hard-coded colours, logos or club names. Only CSS variables:
  --brand, --brand-contrast, --surface, --text, --accent, --group-1..4 (+ auto text colour per group).
- theme/<club>.json: clubName, title, logos (wordmark + ring as data-URIs), colours,
  default group names + colours, floorplan model (see F), help texts overrides.
- `node build.js --theme=<club>` inlines the theme. Default build without theme = neutral generic theme.
- All UI text in src/strings.js (English now, structure ready for other languages).
- Text colour on a group colour is chosen automatically (white or navy by luminance).
- Club theme (padelnext): navy #0B1F5C primary; groups blue #1F3FBF, pink #E0489B, orange #E5561E,
  turquoise #3FD0B8; accent yellow #F7E84B. (Estimated from logo, to be replaced by exact values.)
- Per tournament: group colours editable (defaults from theme); optional sponsor logo upload
  (downscaled client-side, max ~200 KB, stored in state, included in JSON export), shown in
  header next to club logo and on final standings.

## B. Names input (Setup)
- Per group: one big textarea, one name per line, Enter = new line, paste from Excel works,
  auto-capitalise, trim, no level/status per player at this stage.
- Teams mode: one line per team, separators `/`, `&`, `+` or Tab, spaces optional.
  Comma is NOT a separator. After adding, teams show as two columns (Player 1 | Player 2).
- Duplicates (case/space-insensitive): row turns red with reason + button "Add as Jan (2)".
  No more generic "Added 0. Skipped 1" message; show per-line errors.
- Optional import: paste from Excel or CSV, columns `name` and optional `level`.
- After a group is added, it shows as a checklist (see C).

## C. Check-in and statuses
- Statuses: Not checked in (default) | Present | Late | Absent.
- Checklist per group: chips for the 4 statuses, search box, "Mark all present".
- Only Present and Late are scheduled. Starting with "Not checked in" players: warning,
  they are excluded (treated as Absent).
- Changing a status before/while running regenerates the Suggested rounds (not confirmed ones).
- Absent players are shown greyed at the bottom of the resting panel with label "Absent"
  and do not count in the rest fairness.

## D. Late players (scheduler + presentation)
- Late player = scheduled, but marked Late. Applies per round; resolved at confirmation.
- A Late player is placed on a "pending court": the court with the players who would otherwise
  rest (the odd ones), so a court does not disappear because of one late player.
  Max 2 Late players per pending court. Late players are grouped on the SAME pending court.
- Pending court shows the present players waiting + reserved slot(s) "Late: Jan".
  No scores count while pending. Americano teams mode: a team with a late player is a late team.
- Host sets Late → Present at any time, also mid-round: pending court becomes a normal match,
  score counts. No timer; the host decides how long to wait.
- Late → Absent: the court lapses, the present players of that court move to the Resting panel,
  count as rested for that round. The Late/Absent player gets no rest credit.
- Confirm round with a Late player still not present: dialog per late player,
  default "Absent (match lapses)", alternative "Present". "Late" never carries into the next round.
- Later Suggested rounds: Late players are planned as Resting by default;
  they play only after the host sets them Present.
- Pending-court visual (striped card) only in Floorplan view; Compact view shows a normal card
  with "Waiting for Jan" label. Logic identical in both views.
- Tests required: 1 late player (odd rest group); 2 late players same court; late → present
  mid-round; late → absent (court lapses, rest counts); confirm with late player;
  late in teams mode; fairness of rests not distorted by lapses.

## E. Round flow and scores
- Confirm round: dialog "Confirm Round N? The lineup will be locked." Unlock round
  possible via "Unlock round" (admin action with warning); unlocking regenerates later Suggested rounds.
- Score inputs: active field gets a coloured border; arrows / Enter / Tab move to next field
  (order: court by court, team A then B). Numeric keyboard on iPad (`inputmode="numeric"`)
  and auto-advance after a valid entry; test on iPad Safari.
- Winner highlight: after both scores of a match are entered, the team with more games is bold,
  the other lighter; draw = both bold.
- Colour dots (Rankings and Find player only, not on court cards): one dot per round per player,
  green = played, red = rested, grey = absent; lighter tint for Suggested rounds.
- Long names: shrink font first; if it still does not fit, last part becomes initial ("Meredith O.");
  if two shortened names collide in one round use more letters ("Jan Be." / "Jan Ba.");
  full name on hover/tap.

## F. Courts, floorplan, Compact view
- Two views, switchable: Compact (cards fill the screen) and Floorplan.
- Floorplan model in the theme: rows, cols, numbering start (bottom-left, row by row upward),
  entrance at bottom with arrow ("Reception"), optional court tags (e.g. "WPT" badge,
  surface colour hint as subtle border/icon only; no effect on scheduling).
  Club: 3x3, court 1 bottom-left, court 9 top-right, reception at bottom.
- Unused courts shown grey "Unused". If courts > rows*cols or no floorplan in theme: Compact only.
- Court allocation per group by clicking on the floorplan; default = contiguous courts per group.
- Court cards use group colour; automatic contrast text.

## G. Find player
- Search box on Find tab: list with "Court N" or "Resting" (+ colour dots).
- Matching player is highlighted in a colour on the court card in the Rounds tab as well.

## H. Help for first-time users
- Short help text under each Setup step, a "?" button per screen,
  optional first-run tour of max 4 steps (skippable, shown once; flag in localStorage).

## I. Hosting and PWA (last)
- Deploy dist file as static page (GitHub Pages or Netlify), manifest + service worker for offline,
  iPad-friendly. Data stays in localStorage per device; JSON export remains the backup.

## QA inputs
QA_REPORT.md findings (bugs) are fixed in M6 before new features. Known: Find player not working.

## Milestones (one prompt each, commit between)
- M6: A + QA bugfixes. Done when: theme build works, no hard-coded colours, strings.js complete.
- M7: B + C (UI only, statuses in state, regenerate on change). Done when: add 69 names fast, check-in works.
- M8: D scheduler/tests. Done when: all D tests pass, fairness tests still pass.
- M9: F + D presentation. Done when: floorplan 3x3 with unused + pending court, Compact fallback.
- M10: E + G + H. Done when: scores via keyboard, dots, highlights, dialogs work.
- M11: I. Done when: opens on iPad from a link and works offline.

## Out of scope
Backend/sync, accounts, printing, screenshots by Claude, multiple sponsors (one for now).