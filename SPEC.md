# Padel Americano Organizer — Spec

## Goal
One offline HTML file (laptop browser, screen-shared) for a padel club to run an
Americano or Americano Teams tournament for 12–100 players. English UI.

## Tech
- Deliverable: dist/padel.html, built from src/ (scheduler.js, app.js, style.css,
  index.template.html) by build.js, which inlines everything.
- Persistence: localStorage autosave on every change + Export/Import full state as JSON.
- Tests: plain Node `assert`, file test/scheduler.test.js.

## Concepts
- Player: id, name, group. Group = level, free name (e.g. Advanced, Beginner), 1–4 groups.
- Mode (chosen before start): "americano" (individual, partners change every round)
  or "teams" (fixed pairs entered as "Name1 / Name2"; pairs play against other pairs).
- Court: numbered; user selects which courts are available.
- Round: list of matches + list of resting players. Status: draft | confirmed.
  All groups play the same round in parallel, each on its own courts.
- Match: court, group, teamA (2), teamB (2), scoreA, scoreB (games; empty until entered).

## Setup screen
1. Mode.
2. Players: bulk-paste textarea per group (one name per line) + add/rename/remove.
   Duplicate names rejected.
3. Courts: select available courts. Auto-assign courts to groups proportionally to
   group size (largest remainder; min 1 court if group >= 4 players (teams: >= 2 teams);
   max floor(n/4) courts per group (teams: floor(t/2)); redistribute leftovers).
   User can manually override per group. Show per group: players, courts,
   playing per round, resting per round.
4. Number of rounds.
5. Start → round 1 (draft) + suggestions for all remaining rounds.
6. "Load demo (69 players)" button for testing.

## Scheduling (core)
Each group is scheduled independently with its own courts. Per round:
1. Resters = n − 4*courts (teams: t − 2*courts). Pick resters so that total rests per
   player differ by at most 1 at the end; prefer players with fewest rests so far;
   avoid resting the same player in consecutive rounds when possible; ties random (seeded).
2. Form 2v2 matches among playing players minimising cost. Weights as constants at the top:
   - repeated partner (americano): very high
   - repeated opponent (or opponent team in teams mode): high
   - same court as previous round: low
   Players who shared a court earlier should not meet again if avoidable.
   Method suggestion: greedy + random restarts + pairwise-swap local search.
   Must run < 1s for 100 players × 10 rounds.
3. Rounds are generated sequentially using all history.
4. Confirmed rounds = fixed history. Draft rounds = all rounds after the last confirmed one;
   they are regenerated whenever a round is confirmed or the roster changes.
   Draft rounds are labelled "Suggested".

## Editing the current round (first draft round)
- Click two players to swap them (between matches, within a match, or with a resting player,
  same group only).
- Replace/rename a player; mark a player absent (excluded from this and later rounds).
- "Confirm round" locks the lineup, regenerates all later drafts, enables score entry.
- "Regenerate suggestion" gives a different draft (new seed).
- Scores of confirmed rounds stay editable.

## Scoring & ranking
- Score = games per side (non-negative integers). Time limit is handled outside the app.
- Player points = total games won in matches that have a score entered.
  (Team mode: both players get the team's games.)
- Sort by: 1) games won desc, 2) game difference (won − lost) desc,
  3) rounds won desc, then draws desc, then losses asc, 4) still tied → same rank.
- Columns: Rank, Name, Group, Rounds played, Rounds rested, Games won, Games lost, Diff,
  W-D-L, Avg games per played round (info only).
- Filter: per group (default) / all. Live updates. Final standings view must be
  large and readable on a projector.

## Views (tabs)
1. Setup
2. Rounds: round selector (draft/confirmed indicator), arrow keys navigate. Court cards
   coloured per group ("Court 3 — Advanced"), Team A vs Team B with score inputs,
   resting panel grouped by group. Large fonts, readable from 3 meters. Fullscreen button.
3. Find player: alphabetical list of all players with current round assignment
   ("Court 4" / "Resting").
4. Rankings
5. Data: Export JSON, Import JSON, Reset (with confirmation), Fairness report.

## Fairness report (pure function, shown in Data tab and printed in tests)
Per group over all rounds (confirmed + drafts): rests per player (min/max),
max consecutive rests, # repeated partnerships, # repeated opponent pairs,
# players on same court in consecutive rounds.

## Edge cases
Group < 4 players (teams: < 2 teams) → clear error. Group with 0 courts → block start.
More rounds than unique combos → minimise repeats, never crash.

## Out of scope (v1)
Backend, accounts, multi-device sync, skill ratings, printing, tournament history.

## Reference test case (must pass)
69 players = 21 Advanced + 48 Beginner, 9 courts, Americano, 6 rounds.
Expected: Advanced 3 courts (12 play / 9 rest), Beginner 6 courts (24 play / 24 rest).
Rests per player: Advanced 2 or 3, Beginner exactly 3. Targets: 0 repeated partners for
Beginners, 0 consecutive rests. Also test: 12 players/3 courts, 13 players/3 courts,
100 players/12 courts one group, teams mode with 16 teams.