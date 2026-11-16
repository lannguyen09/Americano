'use strict';
const assert = require('assert');
const S = require('../src/scheduler.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// Build a state: groups = [[name, count]], mode, courts, rounds.
function makeState({ groups, mode = 'americano', courts, numRounds, seed = 42 }) {
  const state = { version: 1, mode, seed, numRounds, groups: [], players: [], teams: [], rounds: [] };
  let pid = 0, tid = 0;
  for (const [name, count] of groups) {
    const gid = 'g' + state.groups.length;
    state.groups.push({ id: gid, name, courtsOverride: null });
    for (let i = 0; i < count; i++) {
      if (mode === 'teams') {
        const a = { id: 'p' + pid++, name: `${name} ${i}a`, groupId: gid, absentFromRound: null };
        const b = { id: 'p' + pid++, name: `${name} ${i}b`, groupId: gid, absentFromRound: null };
        state.players.push(a, b);
        state.teams.push({ id: 't' + tid++, groupId: gid, playerIds: [a.id, b.id] });
      } else {
        state.players.push({ id: 'p' + pid++, name: `${name} ${i}`, groupId: gid, absentFromRound: null });
      }
    }
  }
  const courtNos = Array.from({ length: courts }, (_, i) => i + 1);
  const alloc = S.allocateCourts(
    state.groups.map(g => ({ id: g.id, name: g.name, size: S.unitsForGroup(state, g.id).length, override: null })),
    courtNos, mode);
  state.courts = courtNos;
  state.courtAssignment = alloc.assignment;
  state.alloc = alloc;
  return state;
}

// Every active player appears exactly once per round (in a match or resting), 4 per court.
function checkValidity(state, rounds) {
  const k = mode => (mode === 'teams' ? 2 : 4);
  rounds.forEach((r, ri) => {
    const seen = new Map();
    const courts = new Set();
    for (const m of r.matches) {
      assert.ok(!courts.has(m.court), `round ${ri + 1}: court ${m.court} used twice`);
      courts.add(m.court);
      assert.strictEqual(m.teamA.length, 2); assert.strictEqual(m.teamB.length, 2);
      assert.ok(state.courtAssignment[m.groupId].includes(m.court), `court ${m.court} not in group`);
      for (const p of m.teamA.concat(m.teamB)) seen.set(p, (seen.get(p) || 0) + 1);
    }
    for (const p of r.resting) seen.set(p, (seen.get(p) || 0) + 1);
    for (const p of state.players) {
      const active = p.absentFromRound == null || ri < p.absentFromRound;
      assert.strictEqual(seen.get(p.id) || 0, active ? 1 : 0, `round ${ri + 1}: player ${p.id}`);
    }
    void k;
  });
}

const byName = (rep, name) => rep.find(r => r.group === name);

// ---------- Court allocation ----------
test('allocate 69 players: Advanced 3 courts, Beginner 6 courts', () => {
  const st = makeState({ groups: [['Advanced', 21], ['Beginner', 48]], courts: 9, numRounds: 6 });
  assert.deepStrictEqual(st.alloc.errors, []);
  assert.deepStrictEqual(st.alloc.counts, { g0: 3, g1: 6 });
  assert.deepStrictEqual(S.groupLoad(21, 3, 'americano'), { courts: 3, playing: 12, resting: 9 });
  assert.deepStrictEqual(S.groupLoad(48, 6, 'americano'), { courts: 6, playing: 24, resting: 24 });
});

test('allocate caps at floor(n/4) and leaves courts idle', () => {
  const a = S.allocateCourts([{ id: 'a', name: 'A', size: 12, override: null }], [1, 2, 3, 4, 5], 'americano');
  assert.strictEqual(a.counts.a, 3);
  assert.deepStrictEqual(a.idle, [4, 5]);
});

test('allocate: min 1 court for a small group', () => {
  const a = S.allocateCourts([
    { id: 'a', name: 'A', size: 4, override: null },
    { id: 'b', name: 'B', size: 60, override: null }], [1, 2, 3, 4, 5, 6], 'americano');
  assert.deepStrictEqual(a.counts, { a: 1, b: 5 });
  assert.deepStrictEqual(a.errors, []);
});

test('allocate: errors for tiny group, too few courts, bad override', () => {
  const a = S.allocateCourts([{ id: 'a', name: 'A', size: 3, override: null }], [1], 'americano');
  assert.ok(a.errors.some(e => e.includes('at least 4')));
  const b = S.allocateCourts([
    { id: 'a', name: 'A', size: 8, override: null }, { id: 'b', name: 'B', size: 8, override: null }], [1], 'americano');
  assert.ok(b.errors.some(e => e.includes('Not enough courts')));
  const b2 = S.allocateCourts([{ id: 'a', name: 'A', size: 8, override: 0 }], [1], 'americano');
  assert.ok(b2.errors.some(e => e.includes('0 courts')));
  const c = S.allocateCourts([{ id: 'a', name: 'A', size: 8, override: 3 }], [1, 2, 3], 'americano');
  assert.ok(c.errors.some(e => e.includes('at most 2')));
  const d = S.allocateCourts([{ id: 'a', name: 'A', size: 1, override: null }], [1], 'teams');
  assert.ok(d.errors.some(e => e.includes('at least 2 teams')));
});

test('allocate: override respected, rest auto-assigned', () => {
  const a = S.allocateCourts([
    { id: 'a', name: 'A', size: 20, override: 1 }, { id: 'b', name: 'B', size: 20, override: null }],
  [1, 2, 3, 4, 5, 6], 'americano');
  assert.deepStrictEqual(a.counts, { a: 1, b: 5 });
  assert.deepStrictEqual(a.assignment, { a: [1], b: [2, 3, 4, 5, 6] });
});

// ---------- Scheduling ----------
test('determinism: same seed → same schedule; different seed → different', () => {
  const st = makeState({ groups: [['A', 20]], courts: 4, numRounds: 4 });
  const a = JSON.stringify(S.scheduleState(st, 1));
  assert.strictEqual(a, JSON.stringify(S.scheduleState(st, 1)));
  assert.notStrictEqual(a, JSON.stringify(S.scheduleState(st, 2)));
});

let ref69;
test('REFERENCE 69 players / 9 courts / 6 rounds', () => {
  const st = makeState({ groups: [['Advanced', 21], ['Beginner', 48]], courts: 9, numRounds: 6 });
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  const rep = S.fairnessReport(st, rounds);
  ref69 = rep;
  const adv = byName(rep, 'Advanced'), beg = byName(rep, 'Beginner');
  assert.ok(adv.restsMin >= 2 && adv.restsMax <= 3, `Advanced rests ${adv.restsMin}-${adv.restsMax}`);
  assert.strictEqual(beg.restsMin, 3); assert.strictEqual(beg.restsMax, 3);
  assert.strictEqual(beg.repeatedPartnerships, 0, 'Beginner repeated partners');
  assert.strictEqual(adv.maxConsecutiveRests, 1, 'Advanced consecutive rests');
  assert.strictEqual(beg.maxConsecutiveRests, 1, 'Beginner consecutive rests');
});

test('REFERENCE 69: fairness report shape matches SPEC (per group, all metrics)', () => {
  assert.ok(ref69, 'reference report computed');
  assert.deepStrictEqual(ref69.map(r => [r.group, r.units]), [['Advanced', 21], ['Beginner', 48]]);
  const keys = ['restsMin', 'restsMax', 'maxConsecutiveRests', 'repeatedPartnerships',
    'repeatedOpponentPairs', 'sameCourtConsecutive'];
  for (const r of ref69) for (const k of keys) assert.ok(Number.isInteger(r[k]) && r[k] >= 0, `${r.group}.${k}`);
  const adv = byName(ref69, 'Advanced');
  assert.strictEqual(adv.restsMax - adv.restsMin, 1, 'Advanced rests 2 or 3 (54 rests over 21 players)');
  assert.ok(ref69.every(r => r.maxConsecutiveRests <= 1), '0 consecutive rests');
});

test('69 players: targets hold for 20 different seeds', () => {
  const st = makeState({ groups: [['Advanced', 21], ['Beginner', 48]], courts: 9, numRounds: 6 });
  const bad = [];
  for (let seed = 1; seed <= 20; seed++) {
    const rep = S.fairnessReport(st, S.scheduleState(st, seed));
    const adv = byName(rep, 'Advanced'), beg = byName(rep, 'Beginner');
    if (adv.restsMax - adv.restsMin > 1 || beg.restsMin !== 3 || beg.restsMax !== 3 ||
        beg.repeatedPartnerships || adv.maxConsecutiveRests > 1 || beg.maxConsecutiveRests > 1) bad.push(seed);
  }
  assert.deepStrictEqual(bad, []);
});

test('12 players / 3 courts / 5 rounds: everyone plays, no repeated partners', () => {
  const st = makeState({ groups: [['A', 12]], courts: 3, numRounds: 5 });
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  const [r] = S.fairnessReport(st, rounds);
  assert.strictEqual(r.restsMax, 0);
  assert.strictEqual(r.repeatedPartnerships, 0);
  console.log('     ' + JSON.stringify(r));
});

test('13 players / 3 courts / 6 rounds: one rest per round, 0-1 per player, none consecutive', () => {
  const st = makeState({ groups: [['A', 13]], courts: 3, numRounds: 6 });
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  rounds.forEach(r => assert.strictEqual(r.resting.length, 1));
  const [r] = S.fairnessReport(st, rounds);
  assert.ok(r.restsMax - r.restsMin <= 1 && r.restsMax <= 1);
  assert.strictEqual(r.maxConsecutiveRests, 1);
  assert.strictEqual(r.repeatedPartnerships, 0);
});

test('100 players / 12 courts / 10 rounds, one group: < 1s', () => {
  const st = makeState({ groups: [['A', 100]], courts: 12, numRounds: 10 });
  const t0 = Date.now();
  const rounds = S.scheduleState(st);
  const ms = Date.now() - t0;
  checkValidity(st, rounds);
  const [r] = S.fairnessReport(st, rounds);
  assert.ok(r.restsMax - r.restsMin <= 1, `rests ${r.restsMin}-${r.restsMax}`);
  assert.strictEqual(r.maxConsecutiveRests, 2, 'with 52 of 100 resting, some back-to-back rests are unavoidable');
  assert.strictEqual(r.repeatedPartnerships, 0);
  assert.ok(ms < 1000, `${ms} ms`);
  console.log(`     ${ms} ms ` + JSON.stringify(r));
});

test('100 players / 25 courts / 10 rounds (worst case): < 1s', () => {
  const st = makeState({ groups: [['A', 100]], courts: 25, numRounds: 10 });
  const t0 = Date.now();
  const rounds = S.scheduleState(st);
  const ms = Date.now() - t0;
  checkValidity(st, rounds);
  const [r] = S.fairnessReport(st, rounds);
  assert.strictEqual(r.repeatedPartnerships, 0);
  assert.ok(ms < 1000, `${ms} ms`);
  console.log(`     ${ms} ms ` + JSON.stringify(r));
});

test('teams mode: 16 teams / 6 courts / 8 rounds', () => {
  const st = makeState({ groups: [['A', 16]], mode: 'teams', courts: 6, numRounds: 8 });
  assert.strictEqual(st.alloc.counts.g0, 6);
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  // fixed pairs: teammates always together
  for (const r of rounds) for (const m of r.matches) for (const t of [m.teamA, m.teamB]) {
    assert.ok(st.teams.some(x => x.playerIds[0] === t[0] && x.playerIds[1] === t[1]), 'pair broken');
  }
  const [r] = S.fairnessReport(st, rounds);
  assert.ok(r.restsMax - r.restsMin <= 1);
  assert.strictEqual(r.maxConsecutiveRests, 1);
  assert.strictEqual(r.repeatedOpponentPairs, 0);
  console.log('     ' + JSON.stringify(r));
});

test('confirmed history is kept and drafts continue from it', () => {
  const st = makeState({ groups: [['A', 21]], courts: 3, numRounds: 6 });
  const first = S.scheduleState(st, 7);
  st.rounds = first.slice(0, 2).map(r => ({ ...r, status: 'confirmed' }));
  const again = S.scheduleState(st, 99);
  assert.deepStrictEqual(again.slice(0, 2), st.rounds);
  assert.strictEqual(again.length, 6);
  assert.ok(again.slice(2).every(r => r.status === 'draft'));
  checkValidity(st, again);
  const [r] = S.fairnessReport(st, again);
  assert.ok(r.restsMax - r.restsMin <= 1);
});

test('absent player is excluded from that round on', () => {
  const st = makeState({ groups: [['A', 17]], courts: 4, numRounds: 5 });
  st.players[0].absentFromRound = 2;
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  for (const r of rounds.slice(2)) assert.strictEqual(r.matches.length, 4);
});

test('more rounds than combinations: 4 players / 1 court / 10 rounds does not crash', () => {
  const st = makeState({ groups: [['A', 4]], courts: 1, numRounds: 10 });
  const rounds = S.scheduleState(st);
  checkValidity(st, rounds);
  const [r] = S.fairnessReport(st, rounds);
  assert.ok(r.repeatedPartnerships > 0);
  // 20 pair-instances over 6 player pairs, spread evenly (4,4,3,3,3,3) → 14 repeats
  assert.strictEqual(r.repeatedPartnerships, 14);
});

const partnerKeys = r => r.matches.flatMap(m => [m.teamA, m.teamB]).map(t => t.slice().sort().join('+'));

test('confirm (after a swap) → later rounds regenerate without repeating confirmed partners', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const st = makeState({ groups: [['A', 12]], courts: 3, numRounds: 5, seed });
    st.rounds = S.scheduleState(st);
    const m0 = st.rounds[0].matches[0], m1 = st.rounds[0].matches[1];
    const sw = S.swapPlayers(st, 0, m0.teamA[0], m1.teamB[1]);
    assert.ok(!sw.error, sw.error);
    st.rounds = sw.rounds;
    const before = st.rounds.slice(1).map(r => JSON.stringify(r.matches));
    const res = S.confirmRound(st, 0);
    assert.ok(!res.error, res.error);
    assert.strictEqual(res.rounds[0].status, 'confirmed');
    assert.deepStrictEqual(res.rounds[0].matches, st.rounds[0].matches);
    assert.ok(res.rounds.slice(1).every(r => r.status === 'draft'));
    assert.notDeepStrictEqual(res.rounds.slice(1).map(r => JSON.stringify(r.matches)), before);
    checkValidity(st, res.rounds);
    const confirmed = new Set(partnerKeys(res.rounds[0]));
    for (const r of res.rounds.slice(1)) for (const k of partnerKeys(r)) assert.ok(!confirmed.has(k), `repeat ${k}`);
    assert.strictEqual(S.confirmRound({ ...st, rounds: res.rounds }, 2).error != null, true, 'skip ahead');
  }
});

test('swap validation: same group only, current draft only, teams not with own partner', () => {
  const st = makeState({ groups: [['A', 12], ['B', 12]], courts: 6, numRounds: 3 });
  st.rounds = S.scheduleState(st);
  const inGroup = (r, g) => r.matches.filter(m => m.groupId === g).flatMap(m => m.teamA.concat(m.teamB));
  const [a1, a2] = [inGroup(st.rounds[0], 'g0')[0], inGroup(st.rounds[0], 'g0')[5]];
  const b1 = inGroup(st.rounds[0], 'g1')[0];
  assert.match(S.swapPlayers(st, 0, a1, b1).error, /same group/);
  assert.ok(S.swapPlayers(st, 1, a1, a2).error, 'later draft is read-only');
  const ok = S.swapPlayers(st, 0, a1, a2);
  assert.ok(!ok.error);
  checkValidity(st, ok.rounds);
  const confirmed = S.confirmRound(st, 0).rounds;
  assert.ok(S.swapPlayers({ ...st, rounds: confirmed }, 0, a1, a2).error, 'confirmed is read-only');
  // swap with a resting player
  const st2 = makeState({ groups: [['A', 13]], courts: 3, numRounds: 2 });
  st2.rounds = S.scheduleState(st2);
  const rest = st2.rounds[0].resting[0], play = st2.rounds[0].matches[2].teamB[0];
  const r2 = S.swapPlayers(st2, 0, rest, play).rounds[0];
  assert.deepStrictEqual(r2.resting, [play]);
  assert.ok(r2.matches[2].teamB.includes(rest));
  // teams mode
  const tm = makeState({ groups: [['T', 8]], mode: 'teams', courts: 3, numRounds: 2 });
  tm.rounds = S.scheduleState(tm);
  assert.match(S.swapPlayers(tm, 0, 'p0', 'p1').error, /same team/);
  const tr = S.swapPlayers(tm, 0, 'p0', 'p3').rounds;
  checkValidity(tm, tr);
  for (const r of tr) for (const m of r.matches) for (const t of [m.teamA, m.teamB]) {
    assert.ok(tm.teams.some(x => x.playerIds.join() === t.join()), 'teams stay intact');
  }
});

test('restart keeps players and settings, deletes rounds and scores', () => {
  const st = makeState({ groups: [['A', 12]], courts: 3, numRounds: 4 });
  st.started = true;
  st.players[3].absentFromRound = 2;
  st.rounds = S.confirmRound({ ...st, rounds: S.scheduleState(st) }, 0).rounds;
  st.rounds[0].matches[0].scoreA = 6;
  const r = S.restartTournament(st);
  assert.strictEqual(r.started, false);
  assert.deepStrictEqual(r.rounds, []);
  assert.deepStrictEqual(r.players.map(p => p.name), st.players.map(p => p.name));
  assert.ok(r.players.every(p => p.absentFromRound == null));
  assert.deepStrictEqual([r.mode, r.numRounds, r.courts, r.groups], [st.mode, st.numRounds, st.courts, st.groups]);
  assert.strictEqual(st.rounds.length, 4, 'input not mutated');
});

test('allocate manual (floorplan clicks): courts per group from the map, errors for a group without courts', () => {
  const groups = [{ id: 'a', name: 'Advanced', size: 21 }, { id: 'b', name: 'Beginner', size: 48 }];
  const r = S.allocateManual(groups, { 1: 'a', 3: 'a', 2: 'b', 9: 'b' }, 'americano');
  assert.deepStrictEqual(r.assignment, { a: [1, 3], b: [2, 9] });
  assert.deepStrictEqual(r.errors, []);
  const e = S.allocateManual(groups, { 1: 'a' }, 'americano');
  assert.ok(e.errors.some(x => x.includes('Beginner')));
});

// ---------- Late players (SPEC_v2 §D) ----------
// n units in group 'A'; the last `late` units are Late (teams: first member only).
function lateState({ n, late, courts, numRounds = 6, mode = 'americano' }) {
  const st = makeState({ groups: [['A', n]], mode, courts, numRounds, seed: 11 });
  const units = S.unitsForGroup(st, 'g0');
  const lateUnits = units.slice(n - late);
  for (const u of lateUnits) st.players.find(p => p.id === u.members[0]).status = 'late';
  st.started = true;
  st.rounds = S.scheduleState(st);
  return { st, lateIds: lateUnits.map(u => u.members) };
}
const onCourt = r => r.matches.flatMap(m => m.teamA.concat(m.teamB));
// Every scheduled player exactly once per round in matches / resting / late; others never.
function checkLateValidity(st, rounds) {
  rounds.forEach((r, ri) => {
    const seen = new Map();
    for (const id of onCourt(r).concat(r.resting, r.late || [])) seen.set(id, (seen.get(id) || 0) + 1);
    const courts = r.matches.map(m => m.court);
    assert.strictEqual(new Set(courts).size, courts.length, `round ${ri + 1}: court twice`);
    for (const p of st.players) {
      const team = st.mode === 'teams' ? st.teams.find(t => t.playerIds.includes(p.id)) : null;
      const ok = (team ? team.playerIds : [p.id]).every(id => S.isScheduled(st.players.find(x => x.id === id)));
      assert.strictEqual(seen.get(p.id) || 0, ok ? 1 : 0, `round ${ri + 1}: player ${p.id}`);
    }
  });
}
// App flow: resolve a late unit in the current round, set statuses, regenerate later drafts.
function resolve(st, idx, ids, outcome) {
  st.rounds = st.rounds.slice();
  st.rounds[idx] = S.resolveLate(st.rounds[idx], ids, outcome);
  st.players.filter(p => ids.includes(p.id)).forEach(p => { p.status = outcome; });
  st.rounds = S.scheduleState(st, null, idx + 1);
}
// App flow: confirm round idx; undecided late players get `outcome` (dialog default: absent).
function confirmWithLate(st, idx, outcome = 'absent') {
  const undecided = S.undecidedLate(st.rounds[idx]);
  const units = S.unitsForGroup(st, 'g0').filter(u => u.members.some(id => undecided.includes(id)));
  for (const u of units) resolve(st, idx, u.members, outcome);
  st.rounds = S.confirmRound(st, idx).rounds;
}

test('late: 1 late player (15 present + 1 late, 4 courts) gets a pending court with the odd ones', () => {
  const { st, lateIds } = lateState({ n: 16, late: 1, courts: 4 });
  const [r0] = st.rounds;
  const pend = r0.matches.filter(m => m.pending);
  assert.strictEqual(r0.matches.length, 4);
  assert.strictEqual(pend.length, 1);
  assert.deepStrictEqual(pend[0].late, lateIds[0]);
  assert.strictEqual(pend[0].court, 4, 'pending court is the extra court');
  assert.deepStrictEqual(r0.resting, [], 'the would-be resters play on the pending court');
  assert.ok(r0.matches.filter(m => !m.pending).every(m => !onCourt({ matches: [m] }).includes(lateIds[0][0])));
  for (const r of st.rounds.slice(1)) {
    assert.ok(!r.matches.some(m => m.pending), 'pending only in the current round');
    assert.deepStrictEqual(r.late, lateIds[0], 'later rounds: late planned as waiting');
    assert.strictEqual(r.matches.length, 3);
  }
  checkLateValidity(st, st.rounds);
});

test('late: no pending court when it adds no court (capped courts, or not enough late)', () => {
  for (const [n, courts] of [[16, 3], [14, 4]]) {
    const { st, lateIds } = lateState({ n, late: 1, courts });
    const [r0] = st.rounds;
    assert.ok(!r0.matches.some(m => m.pending), `${n}/${courts}: no pending court`);
    assert.deepStrictEqual(r0.late, lateIds[0]);
    assert.ok(!onCourt(r0).includes(lateIds[0][0]) && !r0.resting.includes(lateIds[0][0]));
    checkLateValidity(st, st.rounds);
  }
});

test('late: 2 late players share the SAME pending court; a 3rd waits in round.late', () => {
  const { st, lateIds } = lateState({ n: 17, late: 3, courts: 5 }); // 14 present: 3 courts + 2 odd
  const [r0] = st.rounds;
  const pend = r0.matches.filter(m => m.pending);
  assert.strictEqual(pend.length, 1);
  assert.strictEqual(pend[0].late.length, 2);
  assert.deepStrictEqual(r0.late, [lateIds[2][0]]);
  checkLateValidity(st, st.rounds);
});

test('late → present mid-round: pending court becomes a normal match, later rounds include the player', () => {
  const { st, lateIds } = lateState({ n: 16, late: 1, courts: 4 });
  const before = st.rounds[0];
  resolve(st, 0, lateIds[0], 'present');
  const r0 = st.rounds[0];
  assert.ok(!r0.matches.some(m => m.pending || m.late));
  assert.deepStrictEqual(r0.matches.map(m => [m.court, m.teamA, m.teamB]), before.matches.map(m => [m.court, m.teamA, m.teamB]));
  for (const r of st.rounds.slice(1)) {
    assert.ok(!r.late);
    assert.ok(onCourt(r).concat(r.resting).includes(lateIds[0][0]));
  }
  checkLateValidity(st, st.rounds);
});

test('late → absent: court lapses, its present players rest (with credit), late player gets none', () => {
  const { st, lateIds } = lateState({ n: 16, late: 1, courts: 4 });
  const pend = st.rounds[0].matches.find(m => m.pending);
  const fill = onCourt({ matches: [pend] }).filter(id => id !== lateIds[0][0]);
  resolve(st, 0, lateIds[0], 'absent');
  const r0 = st.rounds[0];
  assert.strictEqual(r0.matches.length, 3);
  assert.deepStrictEqual(r0.lapsed, [pend.court]);
  assert.deepStrictEqual(r0.resting.slice().sort(), fill.slice().sort());
  assert.ok(!r0.resting.includes(lateIds[0][0]) && !r0.late);
  st.rounds = S.confirmRound(st, 0).rounds;
  const [rep] = S.fairnessReport(st, st.rounds.slice(0, 1));
  assert.strictEqual(rep.restsMax, 1);
  checkLateValidity(st, st.rounds.slice(1));
});

test('late: two late on one court, one absent → court lapses; other undecided → round.late, present → resting', () => {
  for (const firstPresent of [false, true]) {
    const { st, lateIds } = lateState({ n: 16, late: 2, courts: 4 }); // 14 present: 2 odd + 2 late
    const [a, b] = lateIds;
    if (firstPresent) resolve(st, 0, a, 'present');
    resolve(st, 0, b, 'absent');
    const r0 = st.rounds[0];
    assert.strictEqual(r0.matches.length, 3);
    assert.ok(!onCourt(r0).includes(b[0]) && !r0.resting.includes(b[0]));
    if (firstPresent) { assert.ok(r0.resting.includes(a[0])); assert.ok(!r0.late); }
    else { assert.deepStrictEqual(r0.late, a); assert.ok(!r0.resting.includes(a[0])); }
    assert.deepStrictEqual(S.undecidedLate(r0), firstPresent ? [] : a);
  }
});

test('late: confirm with a late player still late → absent (lapse) or present; Late never carries over', () => {
  for (const outcome of ['absent', 'present']) {
    const { st, lateIds } = lateState({ n: 16, late: 1, courts: 4 });
    confirmWithLate(st, 0, outcome);
    const p = st.players.find(x => x.id === lateIds[0][0]);
    assert.strictEqual(p.status, outcome);
    const r0 = st.rounds[0];
    assert.strictEqual(r0.status, 'confirmed');
    assert.ok(!r0.matches.some(m => m.pending) && !r0.late);
    assert.strictEqual(r0.matches.length, outcome === 'present' ? 4 : 3);
    assert.ok(st.rounds.slice(1).every(r => !r.late && !r.matches.some(m => m.pending)));
    checkLateValidity(st, st.rounds.slice(1));
  }
});

test('late in teams mode: a team with one late player is a late team on the pending court', () => {
  const { st, lateIds } = lateState({ n: 8, late: 1, courts: 4, mode: 'teams' }); // 7 present teams
  const [r0] = st.rounds;
  const pend = r0.matches.filter(m => m.pending);
  assert.strictEqual(pend.length, 1);
  assert.deepStrictEqual(pend[0].late.slice().sort(), lateIds[0].slice().sort(), 'both team members are late');
  assert.ok([pend[0].teamA, pend[0].teamB].some(t => t.join() === lateIds[0].join()));
  checkLateValidity(st, st.rounds);
  resolve(st, 0, lateIds[0], 'absent');
  assert.strictEqual(st.rounds[0].matches.length, 3);
  assert.strictEqual(st.rounds[0].resting.length, 2, 'the present team rests');
});

test('late: rest fairness not distorted by lapses (16 players, 4 courts, 6 rounds)', () => {
  const st = makeState({ groups: [['A', 16]], courts: 4, numRounds: 6, seed: 5 });
  st.started = true;
  st.rounds = S.scheduleState(st);
  for (let ri = 0; ri < 6; ri++) {
    if (ri < 2) { // one late player per round, court lapses, the player is back afterwards
      const p = st.players[ri];
      p.status = 'late';
      st.rounds = S.scheduleState(st);
      assert.ok(st.rounds[ri].matches.some(m => m.pending), `round ${ri + 1}: pending court`);
      confirmWithLate(st, ri, 'absent');
      p.status = 'present';
      st.rounds = S.scheduleState(st);
    } else st.rounds = S.confirmRound(st, ri).rounds;
  }
  const [rep] = S.fairnessReport(st, st.rounds);
  assert.ok(rep.restsMax - rep.restsMin <= 1, `rests ${rep.restsMin}-${rep.restsMax}`);
  assert.ok(rep.maxConsecutiveRests <= 1);
  assert.strictEqual(rep.repeatedPartnerships, 0);
  assert.strictEqual(st.rounds.reduce((s, r) => s + r.resting.length, 0), 6, 'two lapses × 3 rested');
});

test('late → absent in the final round: no crash, rest spread at most 2', () => {
  const st = makeState({ groups: [['A', 16]], courts: 4, numRounds: 6, seed: 3 });
  st.started = true;
  st.rounds = S.scheduleState(st);
  for (let ri = 0; ri < 5; ri++) st.rounds = S.confirmRound(st, ri).rounds;
  st.players[7].status = 'late';
  st.rounds = S.scheduleState(st);
  assert.ok(st.rounds[5].matches.some(m => m.pending));
  confirmWithLate(st, 5, 'absent');
  assert.strictEqual(st.rounds.length, 6);
  assert.ok(st.rounds.every(r => r.status === 'confirmed'));
  const [rep] = S.fairnessReport(st, st.rounds);
  assert.ok(rep.restsMax - rep.restsMin <= 2);
});

test('late: no late players → schedule identical to before (no extra fields)', () => {
  const st = makeState({ groups: [['A', 15]], courts: 4, numRounds: 4 });
  const rounds = S.scheduleState(st);
  assert.ok(rounds.every(r => !('late' in r) && r.matches.every(m => !('pending' in m))));
});

if (ref69) {
  console.log('\nFairness report — reference 69 players, 9 courts, 6 rounds:');
  console.log(S.formatFairness(ref69));
}
console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
