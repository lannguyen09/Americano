'use strict';
const assert = require('assert');
const N = require('../src/names.js');
const S = require('../src/scheduler.js');

let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${e.message}`); }
}
const players = (text, taken = []) => N.parseLines(text, { teams: false, taken });
const teams = (text, taken = []) => N.parseLines(text, { teams: true, taken });

test('capitalise + trim, particles stay lowercase, mixed case kept', () => {
  assert.strictEqual(N.capitalise('  jan   de vries '), 'Jan de Vries');
  assert.strictEqual(N.capitalise('anne-marie'), 'Anne-Marie');
  assert.strictEqual(N.capitalise('van dijk'), 'Van dijk'.replace('dijk', 'Dijk'));
  assert.strictEqual(N.capitalise('McDonald'), 'McDonald');
  assert.strictEqual(N.capitalise('élise'), 'Élise');
});

test('players: one per line, blank lines and CRLF ignored', () => {
  const rows = players('jan\r\n\r\n  piet  \nKlaas\n');
  assert.deepStrictEqual(rows.map(r => r.names[0]), ['Jan', 'Piet', 'Klaas']);
  assert.ok(rows.every(r => r.ok));
});

test('players: Excel paste name<Tab>level, header row skipped', () => {
  const rows = players('Name\tLevel\njan\t3\npiet\n');
  assert.deepStrictEqual(rows.map(r => [r.names[0], r.level]), [['Jan', '3'], ['Piet', null]]);
});

test('teams: separators / & + Tab, spaces optional', () => {
  for (const line of ['jan/piet', 'jan / piet', 'jan&piet', 'jan & piet', 'jan+piet', 'jan + piet', 'jan\tpiet']) {
    const [r] = teams(line);
    assert.ok(r.ok, line);
    assert.deepStrictEqual(r.names, ['Jan', 'Piet'], line);
  }
});

test('teams: comma is NOT a separator', () => {
  const [r] = teams('jan, piet');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'format');
});

test('teams: three names, one name, same name twice', () => {
  assert.strictEqual(teams('a / b / c')[0].reason, 'format');
  assert.strictEqual(teams('jan')[0].reason, 'format');
  assert.strictEqual(teams('jan / JAN ')[0].reason, 'sameTwice');
});

test('duplicates are case/space-insensitive (existing names)', () => {
  const [r] = players('  jan  ', ['JAN']);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'taken');
  assert.deepStrictEqual(r.suggestion, ['Jan (2)']);
  assert.strictEqual(players('Jan  de Vries', ['jan de vries'])[0].reason, 'taken');
  assert.strictEqual(players('jande vries', ['Jan de Vries'])[0].reason, 'taken');
});

test('duplicates within the same paste: "Add as Jan (2)"', () => {
  const rows = players('Jan\njan\n j a n');
  assert.ok(rows[0].ok);
  assert.strictEqual(rows[1].reason, 'dupInList');
  assert.deepStrictEqual(rows[1].suggestion, ['Jan (2)']);
  assert.strictEqual(rows[2].reason, 'dupInList');
});

test('uniqueName skips taken numbers and strips an existing suffix', () => {
  const taken = new Set(['jan', 'jan(2)'].map(N.key));
  assert.strictEqual(N.uniqueName('Jan', taken), 'Jan (3)');
  assert.strictEqual(N.uniqueName('Jan (2)', taken), 'Jan (3)');
});

test('teams duplicate: only the duplicated player gets a suffix', () => {
  const [r] = teams('jan / kees', ['Jan', 'Piet']);
  assert.strictEqual(r.reason, 'taken');
  assert.strictEqual(r.dup, 'Jan');
  assert.deepStrictEqual(r.suggestion, ['Jan (2)', 'Kees']);
});

test('import CSV: header name,level / semicolon / no header', () => {
  assert.strictEqual(N.importToText('level,name\n3,jan\n,piet'), 'jan\t3\npiet');
  assert.strictEqual(N.importToText('jan;2\npiet'), 'jan\t2\npiet');
  assert.strictEqual(N.importToText('"Jan"\t"4"'), 'Jan\t4');
  assert.strictEqual(N.importToText('jan\tpiet\nkees\tbram', true), 'jan\tpiet\nkees\tbram');
});

test('shortName: last part as initial, numbered duplicates kept', () => {
  assert.strictEqual(N.shortName('Jan de Vries'), 'Jan de V.');
  assert.strictEqual(N.shortName('Anna Bakker'), 'Anna B.');
  assert.strictEqual(N.shortName('Anna'), 'Anna');
  assert.strictEqual(N.shortName('Jan Smit (2)'), 'Jan S. (2)');
  assert.strictEqual(N.shortName('Jan (2)'), 'Jan (2)');
});

test('69 names parse fast', () => {
  const text = Array.from({ length: 69 }, (_, i) => 'player ' + i).join('\n');
  const t0 = Date.now();
  const rows = players(text);
  assert.strictEqual(rows.filter(r => r.ok).length, 69);
  assert.ok(Date.now() - t0 < 200);
});

test('scheduler: only Present and Late are scheduled (no status = Present; Late may wait in round.late)', () => {
  const st = ['pending', 'present', 'late', 'absent', undefined];
  const state = {
    mode: 'americano', numRounds: 3, seed: 7, rounds: [],
    groups: [{ id: 'g1', name: 'A' }], courtAssignment: { g1: [1, 2] },
    players: Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, groupId: 'g1', absentFromRound: null, status: st[i % 5] })),
    teams: [],
  };
  const ok = new Set(state.players.filter(p => S.isScheduled(p)).map(p => p.id));
  assert.strictEqual(ok.size, 6);
  assert.strictEqual(S.scheduledUnits(state, 'g1').length, 6);
  for (const r of S.scheduleState(state)) {
    const ids = r.matches.flatMap(m => m.teamA.concat(m.teamB)).concat(r.resting, r.late || []);
    assert.ok(ids.every(id => ok.has(id)), 'unscheduled player in round');
    assert.strictEqual(ids.length, 6);
  }
});

if (failed) { console.log(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nAll names tests passed');
