/* Padel Americano — UI. Uses window.Scheduler (src/scheduler.js). */
(function () {
  'use strict';
  const STORAGE_KEY = 'padel-americano-v1';

  const TABS = [
    ['setup', 'Setup'],
    ['rounds', 'Rounds'],
    ['find', 'Find player'],
    ['rankings', 'Rankings'],
    ['data', 'Data'],
  ];

  function defaultState() {
    return {
      version: 1, mode: 'americano', seed: 1, numRounds: 6, started: false, nextId: 0,
      groups: [], players: [], teams: [], clubCourts: 12, courts: [], courtAssignment: {}, rounds: [],
      ui: { tab: 'setup', roundIdx: 0, rankFilter: 'group' },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (e) { /* ignore corrupt or blocked storage */ }
    return defaultState();
  }

  let state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) if (c != null) node.append(c);
    return node;
  }

  function renderTabs() {
    const nav = document.getElementById('tabs');
    nav.replaceChildren(...TABS.map(([id, label]) => el('button', {
      class: state.ui.tab === id ? 'active' : '',
      onclick: () => { notice = null; state.ui.tab = id; save(); render(); },
    }, label)));
  }

  // ---------- Helpers ----------
  const S = window.Scheduler;
  const R = window.Ranking;
  const COLORS = ['#1f6feb', '#1a7f37', '#c2410c', '#8250df'];
  const DEMO_NAMES = ('Anna Bram Carla Daan Eva Floris Gwen Hugo Iris Jesse Kim Lars Maud Niels Olga ' +
    'Pieter Quinty Ruben Sanne Tim Ursula Victor Wendy Xander Yara Zeno Amber Bas Chloe Dirk Elise Frank ' +
    'Gina Hans Ilse Joost Karin Luuk Mila Noah Odile Paul Rosa Sem Tess Thijs Vera Wout Yvonne Bart Celine ' +
    'Dennis Esther Finn Hanna Ivo Julia Koen Lotte Milan Nina Otto Pim Roos Sven Tara Vince Wim Zoe').split(' ');

  let notice = null;          // {kind: 'error'|'info', text}
  const pasteDrafts = {};     // textarea content per group id (not persisted)

  const norm = s => String(s).trim().replace(/\s+/g, ' ');
  const isTeams = () => state.mode === 'teams';
  const unitWord = () => (isTeams() ? 'teams' : 'players');
  const playerMap = () => new Map(state.players.map(p => [p.id, p]));
  function newId(prefix) { state.nextId = (state.nextId || 0) + 1; return prefix + state.nextId; }

  function act(fn) { notice = null; fn(); save(); render(); }
  function setNotice(kind, text) { notice = { kind, text }; }

  function nameTaken(name, exceptId) {
    const k = norm(name).toLowerCase();
    return state.players.some(p => p.id !== exceptId && p.name.toLowerCase() === k);
  }
  function inConfirmedRound(pid) {
    return state.rounds.some(r => r.status === 'confirmed' &&
      (r.resting.includes(pid) || r.matches.some(m => m.teamA.includes(pid) || m.teamB.includes(pid))));
  }
  function regenerate() {
    if (!state.started) return;
    state.rounds = S.scheduleState(state);
    state.ui.roundIdx = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
  }
  function allocation() {
    return S.allocateCourts(state.groups.map(g => ({
      id: g.id, name: g.name, size: S.unitsForGroup(state, g.id).length, override: g.courtsOverride,
    })), state.courts, state.mode);
  }
  function startErrors() {
    const errs = [];
    if (!state.groups.length) errs.push('Add at least one group.');
    if (!state.courts.length) errs.push('Select at least one court.');
    if (!(state.numRounds >= 1)) errs.push('Set the number of rounds.');
    if (state.groups.length && state.courts.length) errs.push(...allocation().errors);
    return errs;
  }

  // ---------- Setup actions ----------
  function setMode(mode) {
    if (state.started || mode === state.mode) return;
    if (state.players.length && !confirm('Switching mode removes all players. Continue?')) return;
    state.players = []; state.teams = [];
    state.mode = mode;
  }
  function addGroup() {
    if (state.groups.length >= 4) return;
    const used = new Set(state.groups.map(g => g.color));
    let n = state.groups.length + 1;
    while (state.groups.some(g => g.name === `Group ${n}`)) n++;
    state.groups.push({ id: newId('g'), name: `Group ${n}`, color: COLORS.find(c => !used.has(c)) || COLORS[0], courtsOverride: null });
  }
  function removeGroup(gid) {
    const n = S.unitsForGroup(state, gid).length;
    if (n && !confirm(`Remove this group and its ${n} ${unitWord()}?`)) return;
    state.groups = state.groups.filter(g => g.id !== gid);
    state.players = state.players.filter(p => p.groupId !== gid);
    state.teams = state.teams.filter(t => t.groupId !== gid);
  }
  function renameGroup(gid, name) {
    name = norm(name);
    if (!name) return setNotice('error', 'Group name cannot be empty.');
    if (state.groups.some(g => g.id !== gid && g.name.toLowerCase() === name.toLowerCase())) {
      return setNotice('error', `Group "${name}" already exists.`);
    }
    state.groups.find(g => g.id === gid).name = name;
  }
  function addPlayer(gid, name) {
    const p = { id: newId('p'), name, groupId: gid, absentFromRound: null };
    state.players.push(p);
    return p;
  }
  function addLines(gid, text) {
    const rejected = [];
    let added = 0;
    for (const line of text.split('\n').map(norm).filter(Boolean)) {
      if (isTeams()) {
        const parts = line.split('/').map(norm);
        if (parts.length !== 2 || !parts[0] || !parts[1] ||
            parts[0].toLowerCase() === parts[1].toLowerCase() || nameTaken(parts[0]) || nameTaken(parts[1])) {
          rejected.push(line); continue;
        }
        const a = addPlayer(gid, parts[0]), b = addPlayer(gid, parts[1]);
        state.teams.push({ id: newId('t'), groupId: gid, playerIds: [a.id, b.id] });
      } else {
        if (nameTaken(line)) { rejected.push(line); continue; }
        addPlayer(gid, line);
      }
      added++;
    }
    pasteDrafts[gid] = rejected.join('\n');
    if (rejected.length) {
      const why = isTeams() ? 'duplicate name or not in "Name1 / Name2" format' : 'duplicate name';
      setNotice('error', `Added ${added}. Skipped ${rejected.length} (${why}); they are left in the box.`);
    } else if (added) setNotice('info', `Added ${added} ${unitWord()}.`);
    if (added) regenerate();
  }
  function renamePlayer(pid, name) {
    name = norm(name);
    if (!name) return setNotice('error', 'Name cannot be empty.');
    if (nameTaken(name, pid)) return setNotice('error', `"${name}" is already taken.`);
    playerMap().get(pid).name = name;
  }
  function removeUnit(unitId) {
    const team = isTeams() ? state.teams.find(t => t.id === unitId) : null;
    const ids = team ? team.playerIds : [unitId];
    if (ids.some(inConfirmedRound)) {
      return setNotice('error', 'Already played in a confirmed round, so this cannot be removed.');
    }
    state.players = state.players.filter(p => !ids.includes(p.id));
    state.teams = state.teams.filter(t => t.id !== unitId);
    regenerate();
  }
  function setClubCourts(n) {
    n = Math.max(1, Math.min(40, Math.floor(n) || 1));
    state.clubCourts = n;
    state.courts = state.courts.filter(c => c <= n);
  }
  function toggleCourt(c) {
    state.courts = state.courts.includes(c) ? state.courts.filter(x => x !== c) : state.courts.concat(c).sort((a, b) => a - b);
  }
  function setOverride(gid, val) {
    const g = state.groups.find(x => x.id === gid);
    g.courtsOverride = val === '' ? null : Math.max(0, Math.floor(+val) || 0);
  }
  function setRounds(val) {
    const min = state.started ? Math.max(1, S.confirmedPrefix(state.rounds).length) : 1;
    const n = Math.floor(+val);
    if (!(n >= min) || n > 50) return setNotice('error', `Number of rounds must be between ${min} and 50.`);
    state.numRounds = n;
    regenerate();
  }
  function start() {
    const errs = startErrors();
    if (errs.length) return setNotice('error', errs.join(' '));
    state.courtAssignment = allocation().assignment;
    state.seed = (Date.now() % 2147483646) + 1;
    state.started = true;
    state.rounds = S.scheduleState(state);
    state.ui.tab = 'rounds';
    state.ui.roundIdx = 0;
  }
  function loadDemo() {
    if (state.players.length && !confirm('Loading the demo replaces all current players and settings. Continue?')) return;
    const ui = state.ui;
    state = defaultState();
    state.ui = Object.assign(ui, { tab: 'setup', roundIdx: 0 });
    state.groups = [
      { id: newId('g'), name: 'Advanced', color: COLORS[0], courtsOverride: null },
      { id: newId('g'), name: 'Beginner', color: COLORS[1], courtsOverride: null },
    ];
    DEMO_NAMES.forEach((n, i) => addPlayer(state.groups[i < 21 ? 0 : 1].id, n));
    state.clubCourts = 9;
    state.courts = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    state.numRounds = 6;
    setNotice('info', 'Demo loaded: 21 Advanced + 48 Beginner, 9 courts, 6 rounds. Press Start.');
  }

  // ---------- Views ----------
  const views = {};
  const section = (title, ...children) => el('section', { class: 'card' }, el('h2', {}, title), ...children);

  function groupCard(g, locked) {
    const pm = playerMap();
    const units = S.unitsForGroup(state, g.id);
    const ta = el('textarea', {
      rows: 4,
      placeholder: isTeams() ? 'One team per line: Name1 / Name2' : 'One name per line',
      oninput: e => { pasteDrafts[g.id] = e.target.value; },
    });
    ta.value = pasteDrafts[g.id] || '';
    return el('div', { class: 'group', style: `--g:${g.color}` },
      el('div', { class: 'group-head' },
        el('span', { class: 'swatch' }),
        el('input', { class: 'group-name', value: g.name, onchange: e => act(() => renameGroup(g.id, e.target.value)) }),
        el('span', { class: 'muted' }, `${units.length} ${unitWord()}`),
        locked ? null : el('button', { class: 'link danger', onclick: () => act(() => removeGroup(g.id)) }, 'Remove group')),
      el('div', { class: 'paste' }, ta,
        el('button', { onclick: () => act(() => addLines(g.id, ta.value)) }, isTeams() ? 'Add teams' : 'Add players')),
      el('div', { class: 'roster' }, units.map(u => el('div', { class: 'roster-item' },
        u.members.map((pid, i) => [
          i ? el('span', { class: 'muted' }, '/') : null,
          el('input', { value: pm.get(pid).name, onchange: e => act(() => renamePlayer(pid, e.target.value)) }),
        ]),
        el('button', { class: 'x', title: 'Remove', onclick: () => act(() => removeUnit(u.id)) }, '×')))));
  }

  function allocationTable(locked) {
    const alloc = locked ? null : allocation();
    const unit = isTeams() ? 'teams' : 'players';
    const rows = state.groups.map(g => {
      const size = S.unitsForGroup(state, g.id).length;
      const courts = locked ? (state.courtAssignment[g.id] || []) : (alloc.assignment[g.id] || []);
      const load = S.groupLoad(size, courts.length, state.mode);
      return el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: `--g:${g.color}` }), g.name),
        el('td', { class: 'num' }, String(size)),
        el('td', { class: 'num' }, String(courts.length)),
        locked ? null : el('td', {}, el('input', {
          type: 'number', min: 0, class: 'small', value: g.courtsOverride, placeholder: 'auto',
          onchange: e => act(() => setOverride(g.id, e.target.value)),
        })),
        el('td', {}, courts.length ? courts.join(', ') : '—'),
        el('td', { class: 'num' }, String(load.playing)),
        el('td', { class: 'num' }, String(load.resting)));
    });
    const used = new Set(Object.values(locked ? state.courtAssignment : alloc.assignment).flat());
    const idle = state.courts.filter(c => !used.has(c));
    return el('div', {},
      el('table', { class: 'alloc' },
        el('thead', {}, el('tr', {},
          ['Group', unit === 'teams' ? 'Teams' : 'Players', 'Courts', locked ? null : 'Override', 'Court numbers',
            'Playing / round', 'Resting / round'].filter(Boolean).map(h => el('th', {}, h)))),
        el('tbody', {}, rows)),
      idle.length ? el('p', { class: 'muted' }, `Unused courts: ${idle.join(', ')}`) : null,
      !locked ? el('p', { class: 'muted' }, 'Courts are assigned automatically by group size. Type a number to override.') : null);
  }

  views.setup = () => {
    const locked = state.started;
    const wrap = el('div', { class: 'setup' });
    if (notice) wrap.append(el('div', { class: 'notice ' + notice.kind }, notice.text));
    if (locked) {
      wrap.append(el('div', { class: 'notice info' },
        'Tournament started. Mode and courts are locked. Adding or removing players or changing the number of rounds regenerates the suggested rounds.'));
    }

    const modeBtn = (m, label, sub) => el('button', {
      class: 'opt' + (state.mode === m ? ' active' : ''), disabled: locked && state.mode !== m,
      onclick: () => act(() => setMode(m)),
    }, el('strong', {}, label), el('span', {}, sub));
    wrap.append(section('1. Mode', el('div', { class: 'opts' },
      modeBtn('americano', 'Americano', 'Individual, partners change every round'),
      modeBtn('teams', 'Americano Teams', 'Fixed pairs play against other pairs'))));

    wrap.append(section('2. Players',
      el('p', { class: 'muted' }, 'Groups are levels (e.g. Advanced, Beginner), 1–4 groups. Each group plays on its own courts.'),
      el('div', { class: 'groups' }, state.groups.map(g => groupCard(g, locked))),
      !locked && state.groups.length < 4 ? el('button', { onclick: () => act(addGroup) }, '+ Add group') : null));

    const courtNos = Array.from({ length: state.clubCourts || 0 }, (_, i) => i + 1);
    wrap.append(section('3. Courts',
      el('div', { class: 'row' },
        el('label', {}, 'Courts at the club ',
          el('input', { type: 'number', min: 1, max: 40, class: 'small', value: state.clubCourts, disabled: locked,
            onchange: e => act(() => setClubCourts(+e.target.value)) })),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => { state.courts = courtNos.slice(); }) }, 'Select all'),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => { state.courts = []; }) }, 'Select none')),
      el('div', { class: 'court-toggles' }, courtNos.map(c => el('button', {
        class: 'court-btn' + (state.courts.includes(c) ? ' on' : ''), disabled: locked,
        title: `Court ${c}`, onclick: () => act(() => toggleCourt(c)),
      }, String(c)))),
      state.groups.length ? allocationTable(locked) : null));

    wrap.append(section('4. Rounds',
      el('label', {}, 'Number of rounds ',
        el('input', { type: 'number', min: 1, max: 50, class: 'small', value: state.numRounds,
          onchange: e => act(() => setRounds(e.target.value)) }))));

    if (locked) {
      wrap.append(section('5. Start', el('p', {}, `Started with ${state.rounds.length} rounds.`),
        el('button', { class: 'primary', onclick: () => act(() => { state.ui.tab = 'rounds'; }) }, 'Go to Rounds')));
    } else {
      const errs = startErrors();
      wrap.append(section('5. Start',
        errs.length ? el('ul', { class: 'errors' }, errs.map(e => el('li', {}, e))) : null,
        el('div', { class: 'row' },
          el('button', { class: 'primary', disabled: errs.length > 0, onclick: () => act(start) }, 'Start'),
          el('button', { onclick: () => act(loadDemo) }, 'Load demo (69 players)'))));
    }
    return wrap;
  };

  function goRound(i) {
    state.ui.roundIdx = Math.max(0, Math.min(i, state.rounds.length - 1));
    save(); render();
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  // Games per side: empty or a non-negative integer. Saved on every keystroke without re-render.
  function scoreInput(m, key, label) {
    const inp = el('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', class: 'score',
      'aria-label': label, value: m[key] == null ? '' : m[key] });
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      const n = raw === '' ? null : Number(raw);
      const ok = !inp.validity.badInput && (n === null || (Number.isInteger(n) && n >= 0));
      inp.classList.toggle('invalid', !ok);
      m[key] = ok ? n : null;
      save();
    });
    return inp;
  }

  views.rounds = () => {
    if (!state.started || !state.rounds.length) {
      return el('div', { class: 'card empty' }, 'No rounds yet. Add players and courts in Setup, then press Start.');
    }
    const idx = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[idx];
    const pm = playerMap();
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const name = id => (pm.get(id) || { name: '?' }).name;
    const label = r => (r.status === 'confirmed' ? 'Confirmed' : 'Suggested');

    const bar = el('div', { class: 'round-bar' },
      el('button', { class: 'nav', disabled: idx === 0, title: 'Previous round (←)', onclick: () => goRound(idx - 1) }, '‹'),
      el('div', { class: 'pills' }, state.rounds.map((r, i) => el('button', {
        class: `pill ${r.status}${i === idx ? ' active' : ''}`, title: `Round ${i + 1}: ${label(r)}`,
        onclick: () => goRound(i),
      }, String(i + 1)))),
      el('button', { class: 'nav', disabled: idx === state.rounds.length - 1, title: 'Next round (→)', onclick: () => goRound(idx + 1) }, '›'),
      el('button', { class: 'fs-btn', onclick: toggleFullscreen }, document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'));

    const title = el('h2', { class: 'round-title' }, `Round ${idx + 1} of ${state.rounds.length}`,
      el('span', { class: 'badge ' + round.status }, label(round)));

    // Scores can be entered in every round for now (M4 restricts this to confirmed rounds).
    const team = (m, key, label) => {
      const names = m[key === 'scoreA' ? 'teamA' : 'teamB'].map(name).join(' / ');
      return el('div', { class: 'team-row' }, el('div', { class: 'tnames', title: names }, names),
        scoreInput(m, key, label));
    };
    const cards = el('div', { class: 'courts' }, round.matches.map(m => {
      const g = gm.get(m.groupId) || { name: '', color: '#888' };
      return el('div', { class: 'court', style: `--g:${g.color}` },
        el('div', { class: 'court-head' }, `Court ${m.court} — ${g.name}`),
        team(m, 'scoreA', 'Team A games'), el('div', { class: 'vs' }, 'vs'), team(m, 'scoreB', 'Team B games'));
    }));

    const groupsResting = state.groups.map(g => ({
      g, ids: round.resting.filter(id => (pm.get(id) || {}).groupId === g.id).sort((a, b) => name(a).localeCompare(name(b))),
    })).filter(x => x.ids.length);
    const resting = el('div', { class: 'resting' }, el('h3', {}, 'Resting'),
      groupsResting.length ? groupsResting.map(({ g, ids }) => el('div', { class: 'rest-group', style: `--g:${g.color}` },
        el('span', { class: 'rest-label' }, g.name),
        ids.map(id => el('span', { class: 'chip' }, name(id))))) : el('p', { class: 'muted' }, 'Nobody rests this round.'));

    return el('div', { class: 'rounds' }, bar, title, cards, resting);
  };

  const notStarted = () => el('div', { class: 'card empty' }, 'No rounds yet. Add players and courts in Setup, then press Start.');

  let findQuery = '';         // Find player search text (not persisted)

  // Assignment in the round selected on the Rounds tab.
  views.find = () => {
    if (!state.started || !state.rounds.length) return notStarted();
    const ci = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[ci];
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const where = new Map();
    round.matches.forEach(m => m.teamA.concat(m.teamB).forEach(id => where.set(id, `Court ${m.court}`)));
    round.resting.forEach(id => where.set(id, 'Resting'));
    const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name));
    const items = players.map(p => {
      const w = where.get(p.id) || 'Absent';
      const item = el('div', { class: 'find-item', style: `--g:${(gm.get(p.groupId) || { color: '#888' }).color}` },
        el('span', { class: 'find-name' }, p.name),
        el('span', { class: 'find-where' + (w.startsWith('Court') ? '' : ' off') }, w));
      return { item, key: p.name.toLowerCase() };
    });
    const empty = el('p', { class: 'muted' }, 'No player matches.');
    // Filter in place so the search box keeps focus while typing.
    const apply = () => {
      const q = norm(findQuery).toLowerCase();
      let shown = 0;
      for (const { item, key } of items) { const ok = key.includes(q); item.hidden = !ok; shown += ok; }
      empty.hidden = shown > 0;
    };
    const search = el('input', { type: 'search', class: 'find-search', placeholder: 'Search player…',
      'aria-label': 'Search player', value: findQuery });
    search.addEventListener('input', () => { findQuery = search.value; apply(); });
    apply();
    setTimeout(() => search.focus(), 0);
    return el('div', { class: 'find' },
      el('h2', { class: 'round-title' }, `Round ${ci + 1}`,
        el('span', { class: 'badge ' + round.status }, round.status === 'confirmed' ? 'Confirmed' : 'Suggested')),
      search, empty,
      el('div', { class: 'find-list' }, items.map(x => x.item)));
  };

  function rankTable(title, color, rows) {
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const diff = d => (d > 0 ? '+' + d : String(d));
    const head = ['Rank', isTeams() ? 'Team' : 'Name', 'Group', 'Played', 'Rested', 'Won', 'Lost', 'Diff', 'W-D-L', 'Avg'];
    return el('section', { class: 'card rank-card', style: color ? `--g:${color}` : '' },
      el('h2', {}, color ? el('span', { class: 'swatch' }) : null, title),
      el('table', { class: 'rank' },
        el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i > 2 ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map(r => el('tr', {},
          el('td', { class: 'num' }, String(r.rank)),
          el('td', { class: 'rname' }, r.name),
          el('td', {}, el('span', { class: 'swatch', style: `--g:${(gm.get(r.groupId) || {}).color}` }), r.group),
          el('td', { class: 'num' }, String(r.played)),
          el('td', { class: 'num' }, String(r.rested)),
          el('td', { class: 'num strong' }, String(r.won)),
          el('td', { class: 'num' }, String(r.lost)),
          el('td', { class: 'num' }, diff(r.diff)),
          el('td', { class: 'num' }, `${r.w}-${r.d}-${r.l}`),
          el('td', { class: 'num muted' }, r.played ? r.avg.toFixed(1) : '—'))))));
  }

  views.rankings = () => {
    if (!state.started || !state.rounds.length) return notStarted();
    const f = state.ui.rankFilter === 'all' ? 'all' : 'group';
    const bar = el('div', { class: 'row rank-bar' }, [['group', 'Per group'], ['all', 'All']].map(([k, label]) =>
      el('button', { class: f === k ? 'active' : '', onclick: () => act(() => { state.ui.rankFilter = k; }) }, label)));
    const tables = f === 'all'
      ? [rankTable('All groups', null, R.computeRankings(state, null))]
      : state.groups.map(g => rankTable(g.name, g.color, R.computeRankings(state, g.id)));
    return el('div', { class: 'rankings' }, bar, tables);
  };
  views.data = () => section('Data',
    el('p', { class: 'muted' }, 'Export, import and the fairness report come in a later milestone.'),
    el('button', { class: 'danger', onclick: () => act(() => {
      if (confirm('Reset everything? All players, rounds and scores will be deleted.')) state = defaultState();
    }) }, 'Reset'));

  document.addEventListener('keydown', e => {
    if (state.ui.tab !== 'rounds' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      goRound(state.ui.roundIdx + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  document.addEventListener('fullscreenchange', render);

  function render() {
    renderTabs();
    const view = document.getElementById('view');
    const fn = views[state.ui.tab];
    view.replaceChildren(fn ? fn() : el('p', {}, ''));
  }

  render();
})();
