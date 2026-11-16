'use strict';
// Fuzz / property test for scheduler.js and ranking.js. Node built-ins only.
// Usage: node test/fuzz.test.js [configs=300] [masterSeed=20261116]
const assert = require('assert');
const S = require('../src/scheduler.js');
const R = require('../src/ranking.js');

const N_CONFIGS = Number(process.argv[2]) || 300;
const MASTER = Number(process.argv[3]) || 20261116;

// ---------- bookkeeping ----------
const INV = {
  1: 'no crash, runtime < 1s',
  2: 'each active player exactly once per round',
  3: 'rests differ by <= 1 within group',
  4: 'courts used <= allocated, <= floor(n/4) per group',
  5: 'repeated partners (report)',
  6: 'max consecutive rests (report)',
  7: 'same seed -> identical output',
  8: 'confirm k then regenerate keeps 1..k',
  9: 'absent player never scheduled from that round',
  R: 'ranking sorted, shared ranks, totals',
};
const stats = {};
for (const k of Object.keys(INV)) stats[k] = { pass: 0, fail: 0 };
const failures = [];
const fail = (inv, cfg, msg) => {
  stats[inv].fail++;
  failures.push({ inv, seed: cfg.seed, cfg: cfg.desc, msg: String(msg).slice(0, 160) });
};
const pass = inv => stats[inv].pass++;
const check = (inv, cfg, fn) => {
  try { fn(); pass(inv); return true; } catch (e) { fail(inv, cfg, e.message); return false; }
};

const rep = {
  rejected: 0, maxMs: 0, maxMsCfg: null, maxMs100: 0,
  partnerRepeats: 0, partnerAvoidable: 0, cfgAvoidable: 0, americanoGroups: 0,
  consecHist: {}, consecAvoidable: 0,
  restSpreadHist: {},
};

// ---------- config generation ----------
function genConfig(seed) {
  const rng = S.makeRng(seed);
  const mode = rng.next() < 0.5 ? 'americano' : 'teams';
  const nGroups = 1 + rng.int(4);
  let players = 12 + rng.int(89);
  if (mode === 'teams' && players % 2) players--;
  const units = mode === 'teams' ? players / 2 : players;
  const minU = mode === 'teams' ? 2 : 4;
  const g = Math.max(1, Math.min(nGroups, Math.floor(units / minU)));
  // uneven split: each group >= minU units, rest distributed with random weights
  const sizes = Array(g).fill(minU);
  for (let left = units - minU * g; left > 0; left--) {
    // skew: bias towards lower indices to get uneven groups
    sizes[Math.min(g - 1, Math.floor(Math.pow(rng.next(), 1.5) * g))]++;
  }
  const courts = 1 + rng.int(16);
  const numRounds = 1 + rng.int(12);
  return { seed, mode, sizes, courts, numRounds, players };
}

function makeState(cfg) {
  const { mode, sizes, courts, numRounds, seed } = cfg;
  const state = { version: 1, mode, seed, numRounds, groups: [], players: [], teams: [], rounds: [] };
  let pid = 0, tid = 0;
  sizes.forEach((count, gi) => {
    const gid = 'g' + gi;
    state.groups.push({ id: gid, name: 'G' + gi, courtsOverride: null });
    for (let i = 0; i < count; i++) {
      if (mode === 'teams') {
        const a = { id: 'p' + pid++, name: `G${gi} ${i}a`, groupId: gid, absentFromRound: null };
        const b = { id: 'p' + pid++, name: `G${gi} ${i}b`, groupId: gid, absentFromRound: null };
        state.players.push(a, b);
        state.teams.push({ id: 't' + tid++, groupId: gid, playerIds: [a.id, b.id] });
      } else {
        state.players.push({ id: 'p' + pid++, name: `G${gi} ${i}`, groupId: gid, absentFromRound: null });
      }
    }
  });
  const courtNos = Array.from({ length: courts }, (_, i) => i + 1);
  const alloc = S.allocateCourts(
    state.groups.map(g => ({ id: g.id, name: g.name, size: S.unitsForGroup(state, g.id).length, override: null })),
    courtNos, mode);
  state.courts = courtNos;
  state.courtAssignment = alloc.assignment;
  return { state, alloc };
}

// active player ids per round (teams: the whole team is out if any member is absent)
function activeAt(state, r) {
  const set = new Set();
  for (const g of state.groups) {
    for (const u of S.unitsForGroup(state, g.id)) {
      if (u.absentFromRound == null || r < u.absentFromRound) u.members.forEach(p => set.add(p));
    }
  }
  return set;
}

// ---------- invariant checks ----------
function checkInv2(state, rounds) {
  rounds.forEach((r, ri) => {
    const seen = new Map();
    const courts = new Set();
    for (const m of r.matches) {
      assert.ok(!courts.has(m.court), `r${ri + 1}: court ${m.court} used twice`);
      courts.add(m.court);
      assert.ok(m.teamA.length === 2 && m.teamB.length === 2, `r${ri + 1}: team size`);
      for (const p of m.teamA.concat(m.teamB)) seen.set(p, (seen.get(p) || 0) + 1);
    }
    for (const p of r.resting) seen.set(p, (seen.get(p) || 0) + 1);
    const act = activeAt(state, ri);
    for (const p of state.players) {
      const want = act.has(p.id) ? 1 : 0;
      assert.strictEqual(seen.get(p.id) || 0, want, `r${ri + 1}: player ${p.id} seen ${seen.get(p.id) || 0}x, want ${want}`);
    }
    for (const p of seen.keys()) assert.ok(act.has(p), `r${ri + 1}: unknown/inactive id ${p}`);
  });
}

function checkInv4(state, alloc, rounds) {
  const k = state.mode === 'teams' ? 2 : 4;
  const total = Object.values(alloc.counts).reduce((s, x) => s + x, 0);
  assert.ok(total <= state.courts.length, `allocated ${total} > ${state.courts.length}`);
  for (const g of state.groups) {
    const n = S.unitsForGroup(state, g.id).length;
    assert.ok(alloc.counts[g.id] <= Math.floor(n / k), `${g.id}: ${alloc.counts[g.id]} courts > floor(${n}/${k})`);
    assert.strictEqual(state.courtAssignment[g.id].length, alloc.counts[g.id], `${g.id}: assignment length`);
  }
  rounds.forEach((r, ri) => {
    for (const m of r.matches) {
      assert.ok(state.courtAssignment[m.groupId].includes(m.court), `r${ri + 1}: court ${m.court} not allocated to ${m.groupId}`);
    }
    for (const g of state.groups) {
      const used = r.matches.filter(m => m.groupId === g.id).length;
      assert.ok(used <= alloc.counts[g.id], `r${ri + 1}: ${g.id} uses ${used} > ${alloc.counts[g.id]}`);
    }
  });
}

// per-group unit stats: rests, max consecutive rests, partner repeats
function groupMetrics(state, rounds) {
  return state.groups.map(g => {
    const units = S.unitsForGroup(state, g.id);
    const idOf = new Map();
    units.forEach((u, i) => u.members.forEach(p => idOf.set(p, i)));
    const rests = new Array(units.length).fill(0);
    const played = new Array(units.length).fill(0);
    const run = new Array(units.length).fill(0);
    const maxRun = new Array(units.length).fill(0);
    const pairs = new Map();
    for (const r of rounds) {
      const resting = new Set(r.resting.map(p => idOf.get(p)).filter(x => x != null));
      for (let u = 0; u < units.length; u++) {
        run[u] = resting.has(u) ? run[u] + 1 : 0;
        maxRun[u] = Math.max(maxRun[u], run[u]);
      }
      for (const u of resting) rests[u]++;
      for (const m of r.matches) {
        if (m.groupId !== g.id) continue;
        for (const t of [m.teamA, m.teamB]) {
          for (const p of t) if (state.mode === 'americano') played[idOf.get(p)]++;
          if (state.mode === 'americano') {
            const key = t.slice().sort().join('|');
            pairs.set(key, (pairs.get(key) || 0) + 1);
          }
        }
      }
    }
    let repeats = 0;
    for (const c of pairs.values()) repeats += Math.max(0, c - 1);
    return { g, n: units.length, units, rests, played, maxRun, repeats };
  });
}

function sameRounds(a, b, upto) {
  for (let i = 0; i < upto; i++) {
    const x = Object.assign({}, a[i], { status: null }), y = Object.assign({}, b[i], { status: null });
    assert.deepStrictEqual(y, x, `round ${i + 1} changed`);
  }
}

// ---------- main scheduler fuzz ----------
const master = S.makeRng(MASTER);
for (let c = 0; c < N_CONFIGS; c++) {
  const cfg = genConfig(master.int(0x7fffffff));
  cfg.desc = { mode: cfg.mode, players: cfg.players, groups: cfg.sizes, courts: cfg.courts, rounds: cfg.numRounds };
  const { state, alloc } = makeState(cfg);
  if (alloc.errors.length) {
    // allocation rejected the config: must only happen when there truly aren't enough courts
    rep.rejected++;
    check(4, cfg, () => assert.ok(cfg.sizes.length > cfg.courts, `rejected unexpectedly: ${alloc.errors.join('; ')}`));
    continue;
  }

  // 1. no crash + runtime
  let rounds;
  const ok1 = check(1, cfg, () => {
    const t0 = process.hrtime.bigint();
    rounds = S.scheduleState(state);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms > rep.maxMs) { rep.maxMs = ms; rep.maxMsCfg = cfg.desc; }
    if (cfg.players >= 90) rep.maxMs100 = Math.max(rep.maxMs100, ms);
    assert.strictEqual(rounds.length, cfg.numRounds, 'round count');
    assert.ok(ms < 1000, `runtime ${ms.toFixed(0)}ms`);
  });
  if (!ok1 && !rounds) continue;

  check(2, cfg, () => checkInv2(state, rounds));
  check(4, cfg, () => checkInv4(state, alloc, rounds));

  // 3, 5, 6
  const k = state.mode === 'teams' ? 2 : 4;
  const metrics = groupMetrics(state, rounds);
  check(3, cfg, () => {
    for (const m of metrics) {
      const spread = Math.max(...m.rests) - Math.min(...m.rests);
      rep.restSpreadHist[spread] = (rep.restSpreadHist[spread] || 0) + 1;
      assert.ok(spread <= 1, `${m.g.id} (n=${m.n}): rests ${Math.min(...m.rests)}..${Math.max(...m.rests)}`);
    }
  });
  let avoidableHere = 0;
  for (const m of metrics) {
    const mr = Math.max(0, ...m.maxRun);
    rep.consecHist[mr] = (rep.consecHist[mr] || 0) + 1;
    // consecutive rests are avoidable when at most half the group rests each round
    const courtsG = Math.min(alloc.counts[m.g.id], Math.floor(m.n / k));
    const resting = m.n - courtsG * k;
    if (mr > 1 && resting * 2 <= m.n) rep.consecAvoidable++;
    if (state.mode === 'americano') {
      rep.americanoGroups++;
      rep.partnerRepeats += m.repeats;
      // heuristic: avoidable if no player plays more games than distinct possible partners (n-1)
      if (m.repeats > 0 && Math.max(...m.played) <= m.n - 1) { rep.partnerAvoidable += m.repeats; avoidableHere++; }
    }
  }
  if (avoidableHere) {
    rep.cfgAvoidable++;
    failures.push({ inv: 5, seed: cfg.seed, cfg: cfg.desc, msg: `report: ${avoidableHere} group(s) with possibly avoidable partner repeats` });
  }
  pass(5); pass(6);

  // 7. determinism
  check(7, cfg, () => assert.strictEqual(JSON.stringify(S.scheduleState(state)), JSON.stringify(rounds), 'output differs'));

  // 8. confirm rounds 1..k one by one, prefix must stay fixed; then regenerate with a new seed
  const crng = S.makeRng(cfg.seed ^ 0x5bd1e995);
  const kConf = cfg.numRounds === 1 ? 1 : 1 + crng.int(cfg.numRounds - 1); // leave >=1 draft if possible
  let cur = rounds;
  const ok8 = check(8, cfg, () => {
    for (let i = 0; i < kConf; i++) {
      const before = cur;
      const res = S.confirmRound(Object.assign({}, state, { rounds: cur }), i);
      assert.ok(!res.error, `confirmRound(${i}): ${res.error}`);
      cur = res.rounds;
      assert.strictEqual(cur.length, cfg.numRounds, 'length after confirm');
      assert.strictEqual(cur[i].status, 'confirmed');
      sameRounds(before, cur, i + 1);
    }
    const regen = S.scheduleState(Object.assign({}, state, { rounds: cur }), cfg.seed + 1);
    sameRounds(cur, regen, kConf);
    checkInv2(state, regen);
  });

  // 9. mark a random active player absent from round kConf (0-based = first draft), regenerate
  if (ok8 && kConf < cfg.numRounds) {
    check(9, cfg, () => {
      const victim = state.players[crng.int(state.players.length)];
      const st2 = Object.assign({}, state, {
        rounds: cur,
        players: state.players.map(p => (p.id === victim.id ? Object.assign({}, p, { absentFromRound: kConf }) : p)),
      });
      const regen = S.scheduleState(st2);
      sameRounds(cur, regen, kConf);
      for (let r = kConf; r < regen.length; r++) {
        const ids = regen[r].matches.flatMap(m => m.teamA.concat(m.teamB)).concat(regen[r].resting);
        assert.ok(!ids.includes(victim.id), `absent ${victim.id} scheduled in round ${r + 1}`);
      }
      checkInv2(st2, regen);
    });
  }
}

// ---------- ranking fuzz ----------
function genRankingState(seed) {
  const rng = S.makeRng(seed);
  const mode = rng.next() < 0.5 ? 'americano' : 'teams';
  const nGroups = 1 + rng.int(3);
  const state = { mode, groups: [], players: [], teams: [], rounds: [] };
  let pid = 0;
  for (let g = 0; g < nGroups; g++) {
    state.groups.push({ id: 'g' + g, name: 'G' + g });
    const n = mode === 'teams' ? 2 + rng.int(6) : 4 + rng.int(10);
    for (let i = 0; i < n; i++) {
      if (mode === 'teams') {
        const a = { id: 'p' + pid++, name: `N${pid}`, groupId: 'g' + g }, b = { id: 'p' + pid++, name: `N${pid}`, groupId: 'g' + g };
        state.players.push(a, b);
        state.teams.push({ id: 't' + state.teams.length, groupId: 'g' + g, playerIds: [a.id, b.id] });
      } else state.players.push({ id: 'p' + pid++, name: `N${pid}`, groupId: 'g' + g });
    }
  }
  const style = rng.int(4); // 0: empty rounds, 1: all 0-0, 2: many ties, 3: random
  const nRounds = style === 0 ? rng.int(2) : 1 + rng.int(6);
  const score = () => {
    if (style === 1) return 0;
    const r = rng.next();
    if (r < 0.15) return null;
    if (style === 2) return rng.int(3);
    if (r < 0.18) return -1;    // invalid → must be ignored
    if (r < 0.2) return 2.5;    // invalid → must be ignored
    return rng.int(10);
  };
  for (let r = 0; r < nRounds; r++) {
    const round = { status: rng.next() < 0.7 ? 'confirmed' : 'draft', matches: [], resting: [] };
    for (const g of state.groups) {
      const units = mode === 'teams'
        ? rng.shuffle(state.teams.filter(t => t.groupId === g.id).map(t => t.playerIds))
        : rng.shuffle(state.players.filter(p => p.groupId === g.id).map(p => [p.id]));
      const per = mode === 'teams' ? 2 : 4;
      const courts = Math.floor(units.length / per);
      for (let c = 0; c < courts; c++) {
        const blk = units.slice(c * per, c * per + per).flat();
        const s = score();
        round.matches.push({ court: c + 1, groupId: g.id, teamA: blk.slice(0, 2), teamB: blk.slice(2, 4),
          scoreA: style === 2 && rng.next() < 0.5 ? s : score(), scoreB: s });
      }
      round.resting.push(...units.slice(courts * per).flat());
    }
    state.rounds.push(round);
  }
  return { state, style, desc: { mode, groups: nGroups, rounds: nRounds, style: ['empty', '0-0', 'ties', 'random'][style] } };
}

const keyCmp = (a, b) => b.won - a.won || b.diff - a.diff || b.w - a.w || b.d - a.d || a.l - b.l;
const N_RANK = 300;
for (let c = 0; c < N_RANK; c++) {
  const seed = master.int(0x7fffffff);
  const { state, desc } = genRankingState(seed);
  const cfg = { seed, desc };
  check('R', cfg, () => {
    // independent expected totals per player id
    const valid = v => Number.isInteger(v) && v >= 0;
    const exp = new Map(state.players.map(p => [p.id, { played: 0, rested: 0, won: 0, lost: 0, w: 0, d: 0, l: 0 }]));
    for (const r of state.rounds) {
      const counts = r.status === 'confirmed' || r.matches.some(m => valid(m.scoreA) && valid(m.scoreB));
      if (!counts) continue;
      for (const p of r.resting) exp.get(p).rested++;
      for (const m of r.matches) {
        if (!(valid(m.scoreA) && valid(m.scoreB))) continue;
        for (const [ids, f, a] of [[m.teamA, m.scoreA, m.scoreB], [m.teamB, m.scoreB, m.scoreA]]) {
          for (const p of ids) {
            const e = exp.get(p); e.played++; e.won += f; e.lost += a;
            if (f > a) e.w++; else if (f < a) e.l++; else e.d++;
          }
        }
      }
    }
    for (const gid of [null, ...state.groups.map(g => g.id)]) {
      const rows = R.computeRankings(state, gid);
      const nUnits = state.mode === 'teams'
        ? state.teams.filter(t => gid == null || t.groupId === gid).length
        : state.players.filter(p => gid == null || p.groupId === gid).length;
      assert.strictEqual(rows.length, nUnits, `row count (group ${gid})`);
      for (const row of rows) {
        if (gid != null) assert.strictEqual(row.groupId, gid, 'group filter');
        const memberId = state.mode === 'teams' ? state.teams.find(t => t.id === row.id).playerIds[0] : row.id;
        const e = exp.get(memberId);
        for (const k of Object.keys(e)) assert.strictEqual(row[k], e[k], `${row.id}.${k}: ${row[k]} != ${e[k]}`);
        assert.strictEqual(row.diff, e.won - e.lost, `${row.id}.diff`);
      }
      for (let i = 1; i < rows.length; i++) {
        const cmp = keyCmp(rows[i - 1], rows[i]);
        assert.ok(cmp <= 0, `not sorted at ${i} (group ${gid})`);
      }
      for (const row of rows) {
        // standard competition ranking: 1 + number of strictly better rows
        const want = 1 + rows.filter(o => keyCmp(o, row) < 0).length;
        assert.strictEqual(row.rank, want, `${row.id} rank ${row.rank} want ${want} (group ${gid})`);
      }
      if (state.rounds.every(r => !r.matches.some(m => valid(m.scoreA) && valid(m.scoreB)))) {
        assert.ok(rows.every(r => r.rank === 1), 'no scores → everyone rank 1');
      }
    }
  });
}

// ---------- output ----------
const lines = [];
lines.push(`FUZZ master=${MASTER} scheduler configs=${N_CONFIGS} (rejected by allocateCourts: ${rep.rejected}) ranking configs=${N_RANK}`);
for (const [k, name] of Object.entries(INV)) {
  lines.push(`INV ${k.padEnd(2)} ${name.padEnd(44)} pass ${String(stats[k].pass).padStart(4)}  fail ${stats[k].fail}`);
}
lines.push(`  runtime: max ${rep.maxMs.toFixed(0)}ms (>=90 players: ${rep.maxMs100.toFixed(0)}ms) ${JSON.stringify(rep.maxMsCfg)}`);
lines.push(`  rest spread per group: ${JSON.stringify(rep.restSpreadHist)}`);
lines.push(`  partners (americano, ${rep.americanoGroups} groups): repeats total ${rep.partnerRepeats}, possibly avoidable ${rep.partnerAvoidable} in ${rep.cfgAvoidable} configs`);
lines.push(`  max consecutive rests per group: ${JSON.stringify(rep.consecHist)}; >1 while <=50% rest: ${rep.consecAvoidable} groups`);
const hard = failures.filter(f => f.inv !== 5);
const shown = (hard.length ? hard : failures).slice(0, 5);
if (shown.length) lines.push(hard.length ? 'FAILING CONFIGS (max 5):' : 'REPORTED CONFIGS (max 5):');
for (const f of shown) lines.push(JSON.stringify(f));
console.log(lines.join('\n'));
process.exitCode = hard.length ? 1 : 0;
