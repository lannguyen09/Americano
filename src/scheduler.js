/* Padel Americano scheduler — pure functions, no DOM, seeded RNG only. */
(function (root) {
  'use strict';
  const { t } = typeof module !== 'undefined' && module.exports ? require('./strings.js') : root.Strings;

  // ---- Cost weights (tune here) ----
  const W_PARTNER = 1000;   // repeated partner (americano), multiplied by count²
  const W_OPPONENT = 100;   // repeated opponent / opponent team, multiplied by count²
  const W_MET = 30;         // any earlier shared court (partner or opponent), per meeting
  const W_SAME_COURT = 1;   // same court as previous round, per unit

  // ---- Search parameters ----
  const RESTARTS = 6;       // random restarts of the match search per round
  const MAX_PASSES = 30;    // local-search passes per restart
  const REST_ATTEMPTS = 40; // randomised rest plans tried per group

  const unitsPerCourt = mode => (mode === 'teams' ? 2 : 4);

  // ---- Seeded RNG (mulberry32) ----
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const int = n => Math.floor(next() * n);
    const shuffle = arr => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    };
    return { next, int, shuffle };
  }

  // ---- Court allocation ----
  // groups: [{id, name, size (units), override: null|number}], courts: [courtNo]
  // Returns {counts:{id:n}, assignment:{id:[courtNo]}, idle:[courtNo], errors:[string]}
  function allocateCourts(groups, courts, mode) {
    const k = unitsPerCourt(mode);
    const unitName = t(mode === 'teams' ? 'unit.teams' : 'unit.players');
    const errors = [];
    const counts = {};
    const sorted = courts.slice().sort((a, b) => a - b);
    const C = sorted.length;

    for (const g of groups) {
      if (g.size < k) errors.push(t('alloc.errTooSmall', { name: g.name, k, unit: unitName, size: g.size }));
    }

    const fixed = groups.filter(g => g.override != null);
    const auto = groups.filter(g => g.override == null);
    let fixedSum = 0;
    for (const g of fixed) {
      const max = Math.floor(g.size / k);
      if (g.override > max) errors.push(t('alloc.errMax', { name: g.name, max }));
      counts[g.id] = g.override;
      fixedSum += g.override;
    }
    if (fixedSum > C) errors.push(t('alloc.errOverrides', { sum: fixedSum, c: C }));

    const avail = Math.max(0, C - fixedSum);
    const total = auto.reduce((s, g) => s + g.size, 0);
    const info = auto.map(g => {
      const min = g.size >= k ? 1 : 0;
      const max = Math.floor(g.size / k);
      const quota = total ? (avail * g.size) / total : 0;
      return { g, min, max, quota, n: Math.min(max, Math.max(min, Math.floor(quota))) };
    });
    let sum = info.reduce((s, x) => s + x.n, 0);
    // Too many (minimums pushed us over): take back from smallest remainder.
    while (sum > avail) {
      const cand = info.filter(x => x.n > x.min).sort((a, b) => (a.quota - a.n) - (b.quota - b.n))[0];
      if (!cand) break;
      cand.n--; sum--;
    }
    // Leftovers: largest remainder among groups below their max.
    while (sum < avail) {
      const cand = info.filter(x => x.n < x.max).sort((a, b) => (b.quota - b.n) - (a.quota - a.n))[0];
      if (!cand) break;
      cand.n++; sum++;
    }
    for (const x of info) counts[x.g.id] = x.n;

    const needed = groups.reduce((s, g) => s + (g.size >= k ? 1 : 0), 0);
    if (sum + fixedSum > C || needed > C) errors.push(t('alloc.errNotEnough', { needed, c: C }));
    for (const g of groups) {
      if (g.size >= k && !counts[g.id]) errors.push(t('alloc.errZero', { name: g.name }));
    }

    const assignment = {};
    let pos = 0;
    for (const g of groups) {
      assignment[g.id] = sorted.slice(pos, pos + counts[g.id]);
      pos += counts[g.id];
    }
    return { counts, assignment, idle: sorted.slice(pos), errors: [...new Set(errors)] };
  }

  // Playing / resting units per round for a group.
  function groupLoad(size, courts, mode) {
    const k = unitsPerCourt(mode);
    const c = Math.min(courts, Math.floor(size / k));
    return { courts: c, playing: c * k, resting: size - c * k };
  }

  // ---- Statistics (per group, local unit indices) ----
  function newStats(n) {
    return {
      n,
      P: new Uint16Array(n * n),        // partner count
      O: new Uint16Array(n * n),        // opponent count
      M: new Uint16Array(n * n),        // shared-court count
      rests: new Int32Array(n),
      restedLast: new Uint8Array(n),    // current run of consecutive rests

      lastCourt: new Int32Array(n).fill(-1),
    };
  }
  function bump(arr, n, a, b) { arr[a * n + b]++; arr[b * n + a]++; }

  // localRound: {matches:[{court, A:[unit], B:[unit]}], resting:[unit]}
  function applyRound(st, lr) {
    const n = st.n;
    const run = st.restedLast;
    const prevRun = Uint8Array.from(run);
    run.fill(0);
    st.lastCourt.fill(-1);
    for (const m of lr.matches) {
      const all = m.A.concat(m.B);
      for (let i = 0; i < all.length; i++) {
        st.lastCourt[all[i]] = m.court;
        for (let j = i + 1; j < all.length; j++) bump(st.M, n, all[i], all[j]);
      }
      if (m.A.length === 2) bump(st.P, n, m.A[0], m.A[1]);
      if (m.B.length === 2) bump(st.P, n, m.B[0], m.B[1]);
      for (const a of m.A) for (const b of m.B) bump(st.O, n, a, b);
    }
    for (const u of lr.resting) { st.rests[u]++; run[u] = Math.min(255, prevRun[u] + 1); }
  }

  // Convert a state round to a local round for one group.
  function toLocalRound(round, groupId, idx) {
    const map = ids => [...new Set(ids.map(p => idx.get(p)).filter(u => u !== undefined))];
    return {
      matches: round.matches.filter(m => m.groupId === groupId)
        .map(m => ({ court: m.court, A: map(m.teamA), B: map(m.teamB) })),
      resting: map(round.resting || []),
    };
  }

  // ---- Rest planning ----
  const isActive = (u, r) => u.absentFromRound == null || r < u.absentFromRound;

  function planRests(units, st, start, N, k, nCourts, rng) {
    const n = units.length;
    const rounds = [];
    for (let r = start; r < N; r++) {
      const act = [];
      for (let i = 0; i < n; i++) if (isActive(units[i], r)) act.push(i);
      const c = Math.min(nCourts, Math.floor(act.length / k));
      rounds.push({ act, c, R: act.length - k * c });
    }
    // remaining active rounds per unit from round index ri (inclusive)
    const remain = rounds.map((_, ri) => {
      const L = new Int32Array(n);
      for (let s = ri; s < rounds.length; s++) for (const u of rounds[s].act) L[u]++;
      return L;
    });
    const futureRests = rounds.map((_, ri) => rounds.slice(ri).reduce((s, x) => s + x.R, 0));
    const finalUnits = rounds.length ? rounds[rounds.length - 1].act : [];

    let best = null;
    for (let a = 0; a < REST_ATTEMPTS; a++) {
      const rests = Int32Array.from(st.rests);
      let restedLast = Uint8Array.from(st.restedLast);
      const rank = rng.shuffle([...Array(n).keys()]);
      const sets = [];
      let consec = 0;
      for (let ri = 0; ri < rounds.length; ri++) {
        const { act, R } = rounds[ri];
        const L = remain[ri];
        // Water-fill future rests onto units with the fewest rests.
        const need = new Int32Array(n);
        for (let t = 0; t < futureRests[ri]; t++) {
          let bu = -1;
          for (const u of act) {
            if (need[u] >= L[u]) continue;
            if (bu < 0 || rests[u] + need[u] < rests[bu] + need[bu] ||
                (rests[u] + need[u] === rests[bu] + need[bu] && rank[u] < rank[bu])) bu = u;
          }
          if (bu < 0) break;
          need[bu]++;
        }
        const tie = new Float64Array(n);
        for (const u of act) tie[u] = rng.next();
        const urg = u => need[u] - Math.ceil((L[u] - 1) / 2);
        const order = act.slice().sort((x, y) =>
          ((need[y] > 0) - (need[x] > 0)) ||
          (restedLast[x] - restedLast[y]) ||
          (urg(y) - urg(x)) ||
          (need[y] - need[x]) ||
          (tie[x] - tie[y]));
        const chosen = order.slice(0, R);
        const next = new Uint8Array(n);
        for (const u of chosen) {
          if (restedLast[u]) consec += restedLast[u] * restedLast[u]; // longer runs cost more
          rests[u]++;
          next[u] = Math.min(255, restedLast[u] + 1);
        }
        restedLast = next;
        sets.push(chosen);
      }
      let lo = Infinity, hi = -Infinity;
      for (const u of finalUnits) { lo = Math.min(lo, rests[u]); hi = Math.max(hi, rests[u]); }
      const spread = finalUnits.length ? hi - lo : 0;
      const score = Math.max(0, spread - 1) * 1000 + consec;
      if (!best || score < best.score) best = { score, sets };
      if (score === 0) break;
    }
    return rounds.map((x, ri) => ({ act: x.act, c: x.c, resting: best ? best.sets[ri] : [] }));
  }

  // ---- Match search ----
  function matchRound(st, playing, courts, k, rng) {
    const n = st.n;
    const sq = x => x * x;
    const pc = (a, b) => W_PARTNER * sq(st.P[a * n + b]) + W_MET * st.M[a * n + b];
    const oc = (a, b) => W_OPPONENT * sq(st.O[a * n + b]) + W_MET * st.M[a * n + b];

    // best split of a block → {cost, A, B}
    const split4 = blk => {
      const [a, b, c, d] = blk;
      const s1 = pc(a, b) + pc(c, d) + oc(a, c) + oc(a, d) + oc(b, c) + oc(b, d);
      const s2 = pc(a, c) + pc(b, d) + oc(a, b) + oc(a, d) + oc(c, b) + oc(c, d);
      const s3 = pc(a, d) + pc(b, c) + oc(a, b) + oc(a, c) + oc(d, b) + oc(d, c);
      if (s1 <= s2 && s1 <= s3) return { cost: s1, A: [a, b], B: [c, d] };
      if (s2 <= s3) return { cost: s2, A: [a, c], B: [b, d] };
      return { cost: s3, A: [a, d], B: [b, c] };
    };
    const blockCost = k === 4 ? blk => split4(blk).cost : blk => oc(blk[0], blk[1]);
    const nb = courts.length;

    const greedy = () => {
      const pool = rng.shuffle(playing.slice());
      const blocks = [];
      while (pool.length) {
        const blk = [pool.shift()];
        while (blk.length < k) {
          let bi = 0, bc = Infinity;
          for (let i = 0; i < pool.length; i++) {
            let c = 0;
            for (const x of blk) c += Math.min(pc(x, pool[i]), oc(x, pool[i]));
            if (c < bc) { bc = c; bi = i; }
          }
          blk.push(pool.splice(bi, 1)[0]);
        }
        blocks.push(blk);
      }
      return blocks;
    };
    const random = () => {
      const pool = rng.shuffle(playing.slice());
      const blocks = [];
      for (let i = 0; i < nb; i++) blocks.push(pool.slice(i * k, i * k + k));
      return blocks;
    };
    const improve = blocks => {
      const costs = blocks.map(blockCost);
      for (let pass = 0, improved = true; improved && pass < MAX_PASSES; pass++) {
        improved = false;
        for (let i = 0; i < nb; i++) for (let j = i + 1; j < nb; j++) {
          const A = blocks[i], B = blocks[j];
          for (let x = 0; x < k; x++) for (let y = 0; y < k; y++) {
            const ax = A[x]; A[x] = B[y]; B[y] = ax;
            const ca = blockCost(A), cb = blockCost(B);
            if (ca + cb < costs[i] + costs[j] - 1e-9) { costs[i] = ca; costs[j] = cb; improved = true; }
            else { B[y] = A[x]; A[x] = ax; }
          }
        }
      }
      return { blocks, total: costs.reduce((s, c) => s + c, 0) };
    };

    let best = null;
    for (let r = 0; r < RESTARTS; r++) {
      const res = improve(r % 2 === 0 ? greedy() : random());
      if (!best || res.total < best.total) best = res;
      if (best.total === 0) break;
    }
    const blocks = best ? best.blocks : [];

    // Court assignment: minimise units on the same court as last round.
    const courtCost = (blk, court) => W_SAME_COURT * blk.filter(u => st.lastCourt[u] === court).length;
    const order = rng.shuffle([...blocks.keys()]);
    const free = courts.slice();
    const assigned = new Array(nb);
    for (const bi of order) {
      let fi = 0, fc = Infinity;
      for (let i = 0; i < free.length; i++) {
        const c = courtCost(blocks[bi], free[i]);
        if (c < fc) { fc = c; fi = i; }
      }
      assigned[bi] = free.splice(fi, 1)[0];
    }
    for (let i = 0; i < nb; i++) for (let j = i + 1; j < nb; j++) {
      const cur = courtCost(blocks[i], assigned[i]) + courtCost(blocks[j], assigned[j]);
      const sw = courtCost(blocks[i], assigned[j]) + courtCost(blocks[j], assigned[i]);
      if (sw < cur) { const t = assigned[i]; assigned[i] = assigned[j]; assigned[j] = t; }
    }

    return blocks.map((blk, i) => {
      let A, B;
      if (k === 4) ({ A, B } = split4(blk)); else { A = [blk[0]]; B = [blk[1]]; }
      if (rng.next() < 0.5) { const t = A; A = B; B = t; }
      return { court: assigned[i], A, B };
    }).sort((a, b) => a.court - b.court);
  }

  // ---- Group scheduling ----
  // group: {id, courts:[courtNo], units:[{id, members:[playerId], absentFromRound}]}
  function scheduleGroup(group, mode, N, history, seed) {
    const k = unitsPerCourt(mode);
    const rng = makeRng(seed);
    const units = group.units;
    const idx = new Map();
    units.forEach((u, i) => u.members.forEach(p => idx.set(p, i)));
    const st = newStats(units.length);
    for (const round of history) applyRound(st, toLocalRound(round, group.id, idx));

    const plan = planRests(units, st, history.length, N, k, group.courts.length, rng);
    const out = [];
    for (const pr of plan) {
      const resting = new Set(pr.resting);
      const playing = pr.act.filter(u => !resting.has(u));
      const matches = matchRound(st, playing, group.courts.slice(0, pr.c), k, rng);
      applyRound(st, { matches, resting: pr.resting });
      const ids = us => us.flatMap(u => units[u].members);
      out.push({
        matches: matches.map(m => ({
          court: m.court, groupId: group.id, teamA: ids(m.A), teamB: ids(m.B), scoreA: null, scoreB: null,
        })),
        resting: ids(pr.resting),
      });
    }
    return out;
  }

  // input: {mode, numRounds, seed, groups:[{id, courts, units}], history:[round]}
  // Returns history (untouched) followed by draft rounds up to numRounds.
  function scheduleRounds(input) {
    const { mode, numRounds, seed, groups } = input;
    const history = input.history || [];
    const rng = makeRng(seed);
    const perGroup = groups.map(g => scheduleGroup(g, mode, numRounds, history, rng.int(0x7fffffff)));
    const out = history.slice();
    for (let r = history.length; r < numRounds; r++) {
      const gi = r - history.length;
      out.push({
        index: r,
        status: 'draft',
        seed,
        matches: perGroup.flatMap(g => g[gi].matches).sort((a, b) => a.court - b.court),
        resting: perGroup.flatMap(g => g[gi].resting),
      });
    }
    return out;
  }

  // ---- State helpers ----
  // Check-in status: only Present and Late are scheduled ('pending' = not checked in, 'absent').
  // No status (older saved data) counts as Present. Late is scheduled like Present (for now).
  const isScheduled = p => !!p && (p.status == null || p.status === 'present' || p.status === 'late');

  // Units of a group. scheduled: false → excluded from every draft round (absentFromRound 0).
  function unitsForGroup(state, groupId) {
    if (state.mode === 'teams') {
      const byId = new Map(state.players.map(p => [p.id, p]));
      return state.teams.filter(t => t.groupId === groupId).map(t => {
        const scheduled = t.playerIds.every(id => isScheduled(byId.get(id)));
        const abs = t.playerIds.map(id => byId.get(id) && byId.get(id).absentFromRound).filter(x => x != null);
        return { id: t.id, members: t.playerIds.slice(), scheduled,
          absentFromRound: !scheduled ? 0 : abs.length ? Math.min(...abs) : null };
      });
    }
    return state.players.filter(p => p.groupId === groupId)
      .map(p => ({ id: p.id, members: [p.id], scheduled: isScheduled(p),
        absentFromRound: isScheduled(p) ? p.absentFromRound : 0 }));
  }
  const scheduledUnits = (state, groupId) => unitsForGroup(state, groupId).filter(u => u.scheduled);

  function confirmedPrefix(rounds) {
    let last = -1;
    rounds.forEach((r, i) => { if (r.status === 'confirmed') last = i; });
    return rounds.slice(0, last + 1);
  }

  // Regenerates all draft rounds from the confirmed history. Returns a new rounds array.
  // keepUntil (optional): keep rounds[0..keepUntil) as history (e.g. an edited draft) instead.
  function scheduleState(state, seed, keepUntil) {
    const rounds = state.rounds || [];
    return scheduleRounds({
      mode: state.mode,
      numRounds: state.numRounds,
      seed: seed == null ? state.seed : seed,
      history: keepUntil == null ? confirmedPrefix(rounds) : rounds.slice(0, keepUntil),
      groups: state.groups.map(g => ({
        id: g.id,
        courts: (state.courtAssignment && state.courtAssignment[g.id]) || [],
        units: unitsForGroup(state, g.id),
      })),
    });
  }

  // ---- Round editing ----
  // Only the first draft round (directly after the confirmed prefix) can be edited.
  const editableIndex = rounds => confirmedPrefix(rounds).length;

  function roundOf(round, pid) {
    if (round.resting.includes(pid)) return true;
    return round.matches.some(m => m.teamA.includes(pid) || m.teamB.includes(pid));
  }

  // Swap players a and b (teams mode: their whole teams) in rounds[idx].
  // Returns {error} or {rounds} (new array; the edited round is a copy).
  function swapPlayers(state, idx, a, b) {
    const rounds = state.rounds || [];
    const round = rounds[idx];
    if (!round || round.status !== 'draft' || idx !== editableIndex(rounds)) {
      return { error: t('edit.onlyCurrent') };
    }
    if (a === b) return { error: t('edit.twoDifferent') };
    const pm = new Map(state.players.map(p => [p.id, p]));
    const pa = pm.get(a), pb = pm.get(b);
    if (!pa || !pb || !roundOf(round, a) || !roundOf(round, b)) return { error: t('edit.bothInRound') };
    if (pa.groupId !== pb.groupId) return { error: t('edit.sameGroup') };
    let pairs = [[a, b]];
    if (state.mode === 'teams') {
      const team = id => state.teams.find(tm => tm.playerIds.includes(id));
      const ta = team(a), tb = team(b);
      if (!ta || !tb) return { error: t('edit.teamNotFound') };
      if (ta === tb) return { error: t('edit.sameTeam') };
      pairs = ta.playerIds.map((id, i) => [id, tb.playerIds[i]]);
    }
    const swap = new Map();
    for (const [x, y] of pairs) { swap.set(x, y); swap.set(y, x); }
    const sub = ids => ids.map(id => (swap.has(id) ? swap.get(id) : id));
    const copy = Object.assign({}, round, {
      matches: round.matches.map(m => Object.assign({}, m, { teamA: sub(m.teamA), teamB: sub(m.teamB) })),
      resting: sub(round.resting),
    });
    const out = rounds.slice();
    out[idx] = copy;
    return { rounds: out };
  }

  // Confirm rounds[idx] (must be the first draft) and regenerate all later drafts from it.
  function confirmRound(state, idx) {
    const rounds = (state.rounds || []).slice();
    if (!rounds[idx] || idx !== editableIndex(rounds)) return { error: t('edit.confirmOnlyCurrent') };
    rounds[idx] = Object.assign({}, rounds[idx], { status: 'confirmed' });
    return { rounds: scheduleState(Object.assign({}, state, { rounds })) };
  }

  // Restart: keep players and settings, delete rounds and scores, clear absences.
  function restartTournament(state) {
    return Object.assign({}, state, {
      started: false,
      rounds: [],
      players: state.players.map(p => Object.assign({}, p, { absentFromRound: null })),
    });
  }

  // ---- Fairness report ----
  // Per group over all given rounds. Rests are counted over units never marked absent.
  function fairnessReport(state, rounds) {
    rounds = rounds || state.rounds || [];
    return state.groups.map(g => {
      const units = unitsForGroup(state, g.id);
      const idx = new Map();
      units.forEach((u, i) => u.members.forEach(p => idx.set(p, i)));
      const st = newStats(units.length);
      const run = new Int32Array(units.length);
      let maxRun = 0, sameCourt = 0;
      for (const round of rounds) {
        const lr = toLocalRound(round, g.id, idx);
        for (const m of lr.matches) for (const u of m.A.concat(m.B)) {
          if (st.lastCourt[u] === m.court) sameCourt += units[u].members.length;
        }
        const resting = new Set(lr.resting);
        for (let u = 0; u < units.length; u++) {
          run[u] = resting.has(u) ? run[u] + 1 : 0;
          maxRun = Math.max(maxRun, run[u]);
        }
        applyRound(st, lr);
      }
      const n = units.length;
      let repP = 0, repO = 0;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        repP += Math.max(0, st.P[a * n + b] - 1);
        repO += Math.max(0, st.O[a * n + b] - 1);
      }
      const present = [...units.keys()].filter(u => units[u].absentFromRound == null);
      const rs = present.map(u => st.rests[u]);
      return {
        groupId: g.id,
        group: g.name,
        units: n,
        restsMin: rs.length ? Math.min(...rs) : 0,
        restsMax: rs.length ? Math.max(...rs) : 0,
        maxConsecutiveRests: maxRun,
        repeatedPartnerships: repP,
        repeatedOpponentPairs: repO,
        sameCourtConsecutive: sameCourt,
      };
    });
  }

  function formatFairness(report) {
    const cols = [
      ['group', 'fair.group'], ['units', 'fair.units'], ['restsMin', 'fair.restsMin'], ['restsMax', 'fair.restsMax'],
      ['maxConsecutiveRests', 'fair.maxConsec'], ['repeatedPartnerships', 'fair.repPartners'],
      ['repeatedOpponentPairs', 'fair.repOpponents'], ['sameCourtConsecutive', 'fair.sameCourt'],
    ].map(([k, key]) => [k, t(key)]);
    const rows = [cols.map(c => c[1])].concat(report.map(r => cols.map(c => String(r[c[0]]))));
    const w = cols.map((_, i) => Math.max(...rows.map(r => r[i].length)));
    return rows.map(r => r.map((v, i) => v.padEnd(w[i])).join('  ')).join('\n');
  }

  const api = {
    W_PARTNER, W_OPPONENT, W_MET, W_SAME_COURT,
    makeRng, unitsPerCourt, allocateCourts, groupLoad,
    scheduleRounds, scheduleState, unitsForGroup, scheduledUnits, isScheduled, confirmedPrefix,
    editableIndex, swapPlayers, confirmRound, restartTournament,
    fairnessReport, formatFairness,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
