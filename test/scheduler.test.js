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

if (ref69) {
  console.log('\nFairness report — reference 69 players, 9 courts, 6 rounds:');
  console.log(S.formatFairness(ref69));
}
console.log(failed ? `\n${failed} test(s) failed` : '\nAll tests passed');
process.exit(failed ? 1 : 0);
