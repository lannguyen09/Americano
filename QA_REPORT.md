# QA Report

## Automated findings

Source: `node test/fuzz.test.js` (master seed 20261116, 300 scheduler configs + 300 ranking configs).
Each config: 12–100 players, 1–4 uneven groups, 1–16 courts, 1–12 rounds, americano or teams mode.
Reproduce one config by its `seed` (it is passed to `genConfig`). src/ files were not changed.

| # | Invariant | Pass | Fail |
|---|-----------|------|------|
| 1 | No crash, runtime < 1s | 274 | 0 |
| 2 | Each active player is in exactly one place per round (one court or resting) | 274 | 0 |
| 3 | Rests per player differ by at most 1 within a group | 274 | 0 |
| 4 | Courts used ≤ courts allocated, ≤ floor(n/4) per group | 300 | 0 |
| 5 | Repeated partners (reported only) | 274 | – |
| 6 | Max consecutive rests (reported only) | 274 | – |
| 7 | Same seed gives identical output | 274 | 0 |
| 8 | Confirming rounds 1..k, then regenerating, leaves 1..k unchanged | 274 | 0 |
| 9 | An absent player is never scheduled from that round on | 243 | 0 |
| R | Ranking: totals, sort order, shared ranks (empty, 0-0, ties, invalid scores) | 300 | 0 |

**Notes**
- 26 configs were rejected by `allocateCourts` ("Not enough courts"). All of them have more groups than courts, so the rejection is correct (counted as passes for #4).
- Invariant 9 was skipped for 31 configs with only one round, because no draft round is left after confirming it.
- Runtime: the slowest run took 52 ms (88 players, 6 courts, 11 rounds). The slowest run with 90 or more players took 26 ms.
- Rest spread per group: 0 in 171 groups and 1 in 484 groups. No group had a spread above 1.
- Repeated partners (americano, 332 groups): 355 repeats in total. 65 of them, in 10 configs, are flagged "possibly avoidable" by a simple pigeonhole check (no player played more than n−1 games). They are all in small groups (4–24 players) with many rounds. For those groups a schedule with no repeated partner may not exist, so this is not confirmed as a bug. Example seeds: 910001727, 147343211, 1796182512, 2010843969, 558494047.
- Max consecutive rests per group: {0: 104, 1: 380, 2: 85, 3: 42, 4: 22, 5: 9, 6: 6, 7: 3, 8: 3, 11: 1}. Every run longer than 1 happened in a group where more than half the players rest each round (for example, few courts for a large group), where back-to-back rests can't be avoided. No group had a run longer than 1 when it could have been avoided.
- No hard failures were found.
