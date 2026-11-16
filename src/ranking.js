/* Padel Americano ranking — pure function, no DOM. */
(function (root) {
  'use strict';

  const isScore = v => Number.isInteger(v) && v >= 0;
  const hasScore = m => isScore(m.scoreA) && isScore(m.scoreB);
  const rankCmp = (a, b) => b.won - a.won || b.diff - a.diff || b.w - a.w || b.d - a.d || a.l - b.l;

  // Ranked units of a group: players, or teams (both names) in teams mode.
  function units(state, groupId) {
    if (state.mode === 'teams') {
      return state.teams.filter(t => t.groupId === groupId).map(t => ({ id: t.id, members: t.playerIds }));
    }
    return state.players.filter(p => p.groupId === groupId).map(p => ({ id: p.id, members: [p.id] }));
  }

  // One row per unit of the given group (null = all groups).
  // Only matches with both scores entered count; equal scores = draw. Rests count in rounds
  // that are confirmed or have at least one scored match. Ties on all keys share a rank (1, 1, 3).
  function computeRankings(state, groupId) {
    const pm = new Map(state.players.map(p => [p.id, p]));
    const rows = [];
    const rowOf = new Map();
    for (const g of state.groups) {
      if (groupId != null && g.id !== groupId) continue;
      for (const u of units(state, g.id)) {
        const row = {
          id: u.id, name: u.members.map(id => (pm.get(id) || { name: '?' }).name).join(' / '),
          groupId: g.id, group: g.name,
          played: 0, rested: 0, won: 0, lost: 0, diff: 0, w: 0, d: 0, l: 0, avg: 0, rank: 0,
        };
        rows.push(row);
        u.members.forEach(id => rowOf.set(id, row));
      }
    }
    const rowsFor = ids => [...new Set(ids.map(id => rowOf.get(id)).filter(Boolean))];
    for (const r of state.rounds || []) {
      if (r.status !== 'confirmed' && !r.matches.some(hasScore)) continue;
      for (const row of rowsFor(r.resting)) row.rested++;
      for (const m of r.matches) {
        if (m.pending || !hasScore(m)) continue; // no scores count while a court is pending
        for (const [ids, gf, ga] of [[m.teamA, m.scoreA, m.scoreB], [m.teamB, m.scoreB, m.scoreA]]) {
          for (const row of rowsFor(ids)) {
            row.played++; row.won += gf; row.lost += ga;
            if (gf > ga) row.w++; else if (gf < ga) row.l++; else row.d++;
          }
        }
      }
    }
    for (const row of rows) {
      row.diff = row.won - row.lost;
      row.avg = row.played ? row.won / row.played : 0;
    }
    rows.sort((a, b) => rankCmp(a, b) || a.name.localeCompare(b.name));
    rows.forEach((row, i) => { row.rank = i && rankCmp(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1; });
    return rows;
  }

  const api = { computeRankings, hasScore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Ranking = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
