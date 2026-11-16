'use strict';
const assert = require('assert');
const S = require('../src/ranking.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const P = (id, name, groupId = 'g1') => ({ id, name, groupId, absentFromRound: null });
const M = (teamA, teamB, scoreA, scoreB, groupId = 'g1') => ({ court: 1, groupId, teamA, teamB, scoreA, scoreB });
const byName = rows => Object.fromEntries(rows.map(r => [r.name, r]));

function americano(rounds, extraPlayers = []) {
  return {
    mode: 'americano',
    groups: [{ id: 'g1', name: 'Advanced' }, { id: 'g2', name: 'Beginner' }],
    players: ['A', 'B', 'C', 'D', 'E'].map(n => P(n, n)).concat(extraPlayers),
    teams: [],
    rounds,
  };
}

test('games, diff, W-D-L, played, rested, avg', () => {
  const st = americano([
    { status: 'confirmed', resting: ['E'], matches: [M(['A', 'B'], ['C', 'D'], 6, 3)] },
    { status: 'confirmed', resting: ['A'], matches: [M(['B', 'E'], ['C', 'D'], 4, 4)] },
  ]);
  const r = byName(S.computeRankings(st, 'g1'));
  assert.deepStrictEqual([r.B.won, r.B.lost, r.B.diff, r.B.w, r.B.d, r.B.l, r.B.played, r.B.rested], [10, 7, 3, 1, 1, 0, 2, 0]);
  assert.deepStrictEqual([r.A.won, r.A.played, r.A.rested, r.A.avg], [6, 1, 1, 6]);
  assert.deepStrictEqual([r.C.won, r.C.lost, r.C.w, r.C.d, r.C.l], [7, 10, 0, 1, 1]);
  assert.strictEqual(r.E.rested, 1);
});

test('sort order: games won, then diff, then W, D, L', () => {
  const st = americano([
    { status: 'confirmed', resting: [], matches: [M(['A', 'B'], ['C', 'D'], 5, 5)] },
    { status: 'confirmed', resting: [], matches: [M(['A', 'C'], ['B', 'D'], 3, 1)] },
  ]);
  // A 8-6 (W1 D1), C 8-6 (W1 D1), B 6-8, D 6-8 → A, C tied
  const rows = S.computeRankings(st, 'g1').filter(r => r.played);
  assert.deepStrictEqual(rows.map(r => [r.name, r.rank]), [['A', 1], ['C', 1], ['B', 3], ['D', 3]]);
});

test('diff breaks tie on games won', () => {
  const st = americano([
    { status: 'confirmed', resting: [], matches: [M(['A', 'B'], ['C', 'D'], 6, 0)] },
    { status: 'confirmed', resting: [], matches: [M(['C', 'D'], ['A', 'E'], 6, 6)] },
  ]);
  // A: 12 won, 6 lost (+6); C/D: 6 won, 12 lost; B: 6 won, 0 lost (+6) → B above C/D
  const rows = S.computeRankings(st, 'g1');
  assert.deepStrictEqual(rows.slice(0, 2).map(r => r.name), ['A', 'B']);
  assert.ok(rows.find(r => r.name === 'B').rank < rows.find(r => r.name === 'C').rank);
});

test('equal on games, diff and W-D-L → same rank', () => {
  const rows = (() => {
    const st = americano([
      { status: 'confirmed', resting: [], matches: [M(['A', 'B'], ['C', 'D'], 3, 2)] },
      { status: 'confirmed', resting: [], matches: [M(['A', 'C'], ['B', 'D'], 2, 3)] },
      { status: 'confirmed', resting: [], matches: [M(['C', 'E'], ['A', 'D'], 3, 3)] },
    ]);
    return byName(S.computeRankings(st, 'g1'));
  })();
  // A: 8-8, W1 D1 L1; B: 6-4? compute: B won 3+3=6, lost 2+2=4
  assert.strictEqual(rows.A.won, 8);
  assert.strictEqual(rows.A.w, 1); assert.strictEqual(rows.A.d, 1); assert.strictEqual(rows.A.l, 1);
  // C: 2+2+3=7 won; D: 2+3+3=8 won, 8 lost, W1 D1 L1 → same as A → same rank
  assert.strictEqual(rows.D.rank, rows.A.rank);
});

test('unscored matches and untouched draft rounds do not count', () => {
  const st = americano([
    { status: 'confirmed', resting: ['E'], matches: [M(['A', 'B'], ['C', 'D'], 6, null)] },
    { status: 'draft', resting: ['A'], matches: [M(['B', 'E'], ['C', 'D'], null, null)] },
  ]);
  const r = byName(S.computeRankings(st, 'g1'));
  assert.strictEqual(r.A.played, 0);
  assert.strictEqual(r.A.rested, 0);   // draft round without scores is ignored
  assert.strictEqual(r.E.rested, 1);   // confirmed round counts rests
  assert.ok(Object.values(r).every(x => x.rank === 1));
});

test('draft round counts as soon as a score is entered (live update)', () => {
  const st = americano([{ status: 'draft', resting: ['E'], matches: [M(['A', 'B'], ['C', 'D'], null, null)] }]);
  assert.strictEqual(byName(S.computeRankings(st, 'g1')).A.won, 0);
  st.rounds[0].matches[0].scoreA = 6; st.rounds[0].matches[0].scoreB = 2;
  const r = byName(S.computeRankings(st, 'g1'));
  assert.deepStrictEqual([r.A.won, r.A.rank, r.C.lost, r.E.rested], [6, 1, 6, 1]);
});

test('group filter and All', () => {
  const st = americano([
    { status: 'confirmed', resting: [], matches: [M(['A', 'B'], ['C', 'D'], 6, 4), M(['X', 'Y'], ['Z', 'W'], 9, 0, 'g2')] },
  ], ['X', 'Y', 'Z', 'W'].map(n => P(n, n, 'g2')));
  const g1 = S.computeRankings(st, 'g1');
  assert.ok(g1.every(r => r.groupId === 'g1'));
  assert.strictEqual(g1.length, 5);
  const all = S.computeRankings(st, null);
  assert.strictEqual(all.length, 9);
  assert.deepStrictEqual(all.slice(0, 2).map(r => [r.name, r.rank, r.group]), [['X', 1, 'Beginner'], ['Y', 1, 'Beginner']]);
  assert.strictEqual(all[2].rank, 3);
});

test('teams mode: one row per team with both names, team games', () => {
  const st = {
    mode: 'teams',
    groups: [{ id: 'g1', name: 'Advanced' }],
    players: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2'].map(n => P(n, n.toUpperCase())),
    teams: [
      { id: 't1', groupId: 'g1', playerIds: ['a1', 'a2'] },
      { id: 't2', groupId: 'g1', playerIds: ['b1', 'b2'] },
      { id: 't3', groupId: 'g1', playerIds: ['c1', 'c2'] },
    ],
    rounds: [{ status: 'confirmed', resting: ['c1', 'c2'], matches: [M(['a1', 'a2'], ['b1', 'b2'], 7, 5)] }],
  };
  const rows = S.computeRankings(st, 'g1');
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual(rows.map(r => r.name), ['A1 / A2', 'B1 / B2', 'C1 / C2']);
  assert.deepStrictEqual([rows[0].won, rows[0].lost, rows[0].played, rows[0].w], [7, 5, 1, 1]);
  assert.strictEqual(rows[2].rested, 1);
});

// ---------- Round helpers (M10) ----------
const MM = (court, a, b, sa, sb, extra = {}) => Object.assign({ court, groupId: 'g1', teamA: a, teamB: b, scoreA: sa, scoreB: sb }, extra);

test('winner highlight: more games bold, other lighter, draw both bold, incomplete none', () => {
  const m = MM(1, ['A', 'B'], ['C', 'D'], 6, 3);
  assert.strictEqual(S.matchResult(m), 'A');
  assert.deepStrictEqual([S.resultClass(m, 'scoreA'), S.resultClass(m, 'scoreB')], ['win', 'lose']);
  const b = MM(1, ['A', 'B'], ['C', 'D'], 2, 6);
  assert.deepStrictEqual([S.resultClass(b, 'scoreA'), S.resultClass(b, 'scoreB')], ['lose', 'win']);
  const d = MM(1, ['A', 'B'], ['C', 'D'], 4, 4);
  assert.strictEqual(S.matchResult(d), 'draw');
  assert.deepStrictEqual([S.resultClass(d, 'scoreA'), S.resultClass(d, 'scoreB')], ['win', 'win']);
  for (const x of [MM(1, [], [], 6, null), MM(1, [], [], null, null), MM(1, [], [], 6, 2, { pending: true })]) {
    assert.strictEqual(S.matchResult(x), null);
    assert.strictEqual(S.resultClass(x, 'scoreA'), '');
  }
});

test('colour dots: played / rested / absent per round, suggested for drafts', () => {
  const rounds = [
    { status: 'confirmed', matches: [MM(1, ['A', 'B'], ['C', 'D'])], resting: ['E'] },
    { status: 'confirmed', matches: [MM(1, ['A', 'E'], ['C', 'D'])], resting: ['B'] },
    { status: 'draft', matches: [MM(1, ['B', 'E'], ['C', 'D'])], resting: [], late: ['A'] },
  ];
  assert.deepStrictEqual(S.roundDots(rounds, 'A').map(d => [d.kind, d.suggested]),
    [['played', false], ['played', false], ['absent', true]]);
  assert.deepStrictEqual(S.roundDots(rounds, 'E').map(d => d.kind), ['rested', 'played', 'played']);
  assert.deepStrictEqual(S.roundDots(rounds, 'Z').map(d => d.kind), ['absent', 'absent', 'absent']);
  assert.deepStrictEqual(S.roundDots([], 'A'), []);
});

test('score field order: court by court, team A then B (input order ignored)', () => {
  const ms = [MM(5, [], []), MM(2, [], []), MM(9, [], [])];
  assert.deepStrictEqual(S.scoreOrder(ms).map(o => o.court + o.key),
    ['2scoreA', '2scoreB', '5scoreA', '5scoreB', '9scoreA', '9scoreB']);
  assert.deepStrictEqual(S.scoreOrder([MM(1, [], [], null, null, { pending: true })]), []);
});

test('auto-advance: "0", 4-9 and two digits advance; 1-3 wait; invalid never', () => {
  for (const v of ['0', '4', '6', '9', '10', '13', '21', '32']) assert.ok(S.autoAdvance(v), v);
  for (const v of ['', '1', '2', '3', '01', '123', 'a', '6a']) assert.ok(!S.autoAdvance(v), v);
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll ranking tests passed');
