/* Padel Americano — UI. Uses window.Scheduler (src/scheduler.js). */
(function () {
  'use strict';
  const STORAGE_KEY = 'padel-americano-v1';
  const T = window.Strings.t;
  const THEME = window.THEME || {};

  const TABS = ['setup', 'rounds', 'find', 'rankings', 'data'].map(id => [id, T('tab.' + id)]);

  // Header: wordmark + small "Americano" subtitle; title text only when the theme has no wordmark.
  // Ring logo: favicon (and final standings).
  const LOGOS = THEME.logos || {};
  (function applyTheme() {
    const title = THEME.title || T('app.title');
    document.title = title;
    const h1 = document.querySelector('.topbar h1');
    if (LOGOS.wordmark) {
      const img = document.createElement('img');
      img.className = 'logo'; img.src = LOGOS.wordmark; img.alt = THEME.clubName || title;
      const sub = document.createElement('span');
      sub.className = 'subtitle'; sub.textContent = T('app.subtitle');
      h1.replaceChildren(img, sub);
    } else h1.textContent = title;
    if (LOGOS.ring) {
      const link = document.createElement('link');
      link.rel = 'icon'; link.href = LOGOS.ring;
      document.head.append(link);
    }
  })();

  function defaultState() {
    return {
      version: 1, mode: 'americano', seed: 1, numRounds: 6, started: false, nextId: 0,
      groups: [], players: [], teams: [], clubCourts: THEME.floorplan ? THEME.floorplan.rows * THEME.floorplan.cols : 12,
      courts: [], courtMap: null, courtAssignment: {}, rounds: [],
      ui: { tab: 'setup', roundIdx: 0, rankFilter: 'group', roundsView: 'floorplan' },
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
    }, label)), el('button', { class: 'help-btn', title: T('help.btn'), 'aria-label': T('help.btn'), onclick: showHelp }, '?'));
  }

  // ---------- Helpers ----------
  const S = window.Scheduler;
  const N = window.Names;
  const R = window.Ranking;
  // Default group colours come from the CSS variables --group-1..4 (set by the theme).
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const COLORS = [1, 2, 3, 4].map(i => cssVar('--group-' + i) || `var(--group-${i})`);
  // Text on a group colour: dark (--text) on light colours, --brand-contrast on dark ones.
  function groupText(color) {
    const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(color || '').trim());
    if (!m) return 'var(--brand-contrast)';
    const hex = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const [r, g, b] = [0, 2, 4].map(i => lin(parseInt(hex.slice(i, i + 2), 16)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? 'var(--text)' : 'var(--brand-contrast)';
  }
  const gStyle = color => (color ? `--g:${color};--g-text:${groupText(color)}` : '');
  // Mix two hex colours: w of a, (1 - w) of b. Non-hex input → a.
  function mixHex(a, b, w) {
    const rgb = c => { const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(c || '').trim()); if (!m) return null;
      const h = m[1].length === 3 ? m[1].replace(/./g, x => x + x) : m[1]; return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
    const x = rgb(a), y = rgb(b);
    if (!x || !y) return a;
    return '#' + x.map((v, i) => Math.round(v * w + y[i] * (1 - w)).toString(16).padStart(2, '0')).join('');
  }
  const DEMO_NAMES = ('Anna Bram Carla Daan Eva Floris Gwen Hugo Iris Jesse Kim Lars Maud Niels Olga ' +
    'Pieter Quinty Ruben Sanne Tim Ursula Victor Wendy Xander Yara Zeno Amber Bas Chloe Dirk Elise Frank ' +
    'Gina Hans Ilse Joost Karin Luuk Mila Noah Odile Paul Rosa Sem Tess Thijs Vera Wout Yvonne Bart Celine ' +
    'Dennis Esther Finn Hanna Ivo Julia Koen Lotte Milan Nina Otto Pim Roos Sven Tara Vince Wim Zoe').split(' ');

  let notice = null;          // {kind: 'error'|'info', text}
  const pasteDrafts = {};     // textarea content per group id (not persisted)
  const pasteErrors = {};     // rejected rows per group id: [{line, names, reason, dup, suggestion}] (not persisted)
  const searches = {};        // checklist search text per group id (not persisted)
  const STATUSES = ['pending', 'present', 'late', 'absent'];
  let editing = false;        // "Edit setup" unlocked while the tournament runs (not persisted)
  let selected = null;        // player id selected for a swap in the current round (not persisted)

  const norm = s => String(s).trim().replace(/\s+/g, ' ');
  const isTeams = () => state.mode === 'teams';
  const unitWord = () => T(isTeams() ? 'unit.teams' : 'unit.players');
  const playerMap = () => new Map(state.players.map(p => [p.id, p]));
  function newId(prefix) { state.nextId = (state.nextId || 0) + 1; return prefix + state.nextId; }

  function act(fn) { notice = null; fn(); save(); render(); }
  function setNotice(kind, text) { notice = { kind, text }; }

  function nameTaken(name, exceptId) {
    const k = N.key(name);
    return state.players.some(p => p.id !== exceptId && N.key(p.name) === k);
  }
  function inConfirmedRound(pid) {
    return state.rounds.some(r => r.status === 'confirmed' &&
      (r.resting.includes(pid) || r.matches.some(m => m.teamA.includes(pid) || m.teamB.includes(pid))));
  }
  const confirmedCount = () => S.confirmedPrefix(state.rounds || []).length;
  // Mode, courts and groups: editable before start, or in "Edit setup" while nothing is confirmed.
  const courtsLocked = () => state.started && (!editing || confirmedCount() > 0);
  // Players and number of rounds: editable before start, or in "Edit setup".
  const setupLocked = () => state.started && !editing;
  function newSeed() { return (Date.now() % 2147483646) + 1; }

  function regenerate() {
    if (!state.started) return;
    if (!confirmedCount()) {
      const errs = startErrors();
      if (errs.length) {
        state.rounds = [];
        return setNotice('error', T('err.setupInvalid', { errors: errs.join(' ') }));
      }
      state.courtAssignment = allocation().assignment;
    }
    state.rounds = S.scheduleState(state);
    state.ui.roundIdx = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
  }
  // courtMap ({courtNo: groupId}, set by clicking the floorplan) overrides the automatic allocation.
  function allocation() {
    const groups = state.groups.map(g => ({
      id: g.id, name: g.name, size: S.scheduledUnits(state, g.id).length, override: g.courtsOverride,
    }));
    return state.courtMap ? S.allocateManual(groups, state.courtMap, state.mode) : S.allocateCourts(groups, state.courts, state.mode);
  }

  // ---------- Floorplan (theme; presentation only) ----------
  // Null when the theme has none or the club has more courts than grid cells → Compact only.
  function floorplan() {
    const fp = THEME.floorplan;
    return fp && (state.clubCourts || 0) <= fp.rows * fp.cols ? fp : null;
  }
  // Numbering from bottom-left, row by row upward: court 1 bottom-left, rows*cols top-right.
  function courtPos(n, fp) {
    return { row: fp.rows - Math.floor((n - 1) / fp.cols), col: ((n - 1) % fp.cols) + 1 };
  }
  // Grid of all cells; cell(n) builds the card, placed on its position, with the theme's court tags.
  function floorGrid(fp, cell, cls) {
    const nums = Array.from({ length: fp.rows * fp.cols }, (_, i) => i + 1);
    return el('div', { class: 'floor ' + (cls || '') },
      el('div', { class: 'floor-grid', style: `grid-template-columns:repeat(${fp.cols},minmax(0,1fr))` }, nums.map(n => {
        const card = cell(n);
        const pos = courtPos(n, fp);
        const tag = (fp.tags || {})[n] || {};
        card.style.gridRow = pos.row;
        card.style.gridColumn = pos.col;
        if (tag.edge) { card.classList.add('edge'); card.style.setProperty('--edge', tag.edge); }
        if (tag.badge) card.append(el('span', { class: 'court-badge' }, tag.badge));
        return card;
      })),
      fp.reception === 'bottom' || !fp.reception ? el('div', { class: 'reception' }, '▲ ' + T('floor.reception')) : null);
  }
  // Click on the floorplan in Setup: cycle the court through the groups, then "not used".
  function clickCourt(c) {
    if (courtsLocked()) return;
    if (!state.courtMap) {
      state.courtMap = {};
      for (const [gid, cs] of Object.entries(allocation().assignment)) cs.forEach(x => { state.courtMap[x] = gid; });
    }
    const order = [null].concat(state.groups.map(g => g.id));
    const next = order[(order.indexOf(state.courtMap[c] || null) + 1) % order.length];
    if (next) state.courtMap[c] = next; else delete state.courtMap[c];
    state.courts = Object.keys(state.courtMap).map(Number).sort((a, b) => a - b);
    regenerate();
  }
  // Units not checked in (status 'pending'): excluded from the schedule.
  const notCheckedIn = () => state.groups.reduce((n, g) =>
    n + S.unitsForGroup(state, g.id).filter(u => !u.scheduled && unitStatus(u) === 'pending').length, 0);
  function startErrors() {
    const errs = [];
    if (!state.groups.length) errs.push(T('err.noGroup'));
    if (!state.courts.length) errs.push(T('err.noCourt'));
    if (!(state.numRounds >= 1)) errs.push(T('err.noRounds'));
    if (state.groups.length && state.courts.length) errs.push(...allocation().errors);
    return errs;
  }

  // ---------- Setup actions ----------
  function setMode(mode) {
    if (courtsLocked() || mode === state.mode) return;
    if (state.players.length && !confirm(T('confirm.switchMode'))) return;
    state.players = []; state.teams = [];
    state.mode = mode;
    regenerate();
  }
  function addGroup() {
    if (state.groups.length >= 4) return;
    const used = new Set(state.groups.map(g => g.color));
    let n = state.groups.length + 1;
    while (state.groups.some(g => g.name === T('group.default', { n }))) n++;
    state.groups.push({ id: newId('g'), name: T('group.default', { n }), color: COLORS.find(c => !used.has(c)) || COLORS[0], courtsOverride: null });
  }
  function removeGroup(gid) {
    const n = S.unitsForGroup(state, gid).length;
    if (n && !confirm(T('confirm.removeGroup', { n, unit: unitWord() }))) return;
    state.groups = state.groups.filter(g => g.id !== gid);
    state.players = state.players.filter(p => p.groupId !== gid);
    state.teams = state.teams.filter(t => t.groupId !== gid);
    if (state.courtMap) {
      for (const c of Object.keys(state.courtMap)) if (state.courtMap[c] === gid) delete state.courtMap[c];
      state.courts = Object.keys(state.courtMap).map(Number).sort((a, b) => a - b);
    }
    regenerate();
  }
  function renameGroup(gid, name) {
    name = norm(name);
    if (!name) return setNotice('error', T('err.groupNameEmpty'));
    if (state.groups.some(g => g.id !== gid && g.name.toLowerCase() === name.toLowerCase())) {
      return setNotice('error', T('err.groupExists', { name }));
    }
    state.groups.find(g => g.id === gid).name = name;
  }
  function addPlayer(gid, name, level) {
    const p = { id: newId('p'), name, groupId: gid, absentFromRound: null, status: 'pending' };
    if (level) p.level = isNaN(+level) ? level : +level;
    state.players.push(p);
    return p;
  }
  function addUnit(gid, names, level) {
    if (isTeams()) {
      const a = addPlayer(gid, names[0]), b = addPlayer(gid, names[1]);
      state.teams.push({ id: newId('t'), groupId: gid, playerIds: [a.id, b.id] });
    } else addPlayer(gid, names[0], level);
  }
  // Valid lines are added; rejected lines stay in the box and are listed per line with the reason.
  function addLines(gid, text) {
    const rows = N.parseLines(text, { teams: isTeams(), taken: state.players.map(p => p.name) });
    const bad = rows.filter(r => !r.ok);
    rows.filter(r => r.ok).forEach(r => addUnit(gid, r.names, r.level));
    pasteDrafts[gid] = bad.map(r => r.raw).join('\n');
    pasteErrors[gid] = bad;
    if (rows.length > bad.length) regenerate();
  }
  // "Add as Jan (2)": add a rejected duplicate row under its suggested name.
  function addAs(gid, i) {
    const row = (pasteErrors[gid] || [])[i];
    if (!row || !row.suggestion) return;
    if (row.suggestion.some(n => nameTaken(n))) {
      // Suggestion got taken meanwhile: recompute from current names.
      const again = N.parseLines(row.raw, { teams: isTeams(), taken: state.players.map(p => p.name) })[0];
      if (!again || !again.suggestion) return;
      row.suggestion = again.suggestion;
    }
    addUnit(gid, row.suggestion, row.level);
    pasteErrors[gid] = pasteErrors[gid].filter(r => r !== row);
    const lines = (pasteDrafts[gid] || '').split('\n');
    const at = lines.indexOf(row.raw);
    if (at >= 0) lines.splice(at, 1);
    pasteDrafts[gid] = lines.join('\n');
    regenerate();
  }
  function importFile(gid, file) {
    const reader = new FileReader();
    reader.onload = () => act(() => {
      const text = N.importToText(String(reader.result), isTeams());
      addLines(gid, [pasteDrafts[gid] || '', text].filter(Boolean).join('\n'));
    });
    reader.readAsText(file);
  }
  // Check-in: status per player; in teams mode a team's chips set both players.
  function unitStatus(u) {
    const pm = playerMap();
    const st = u.members.map(id => pm.get(id).status || 'present');
    return st.every(x => x === st[0]) ? st[0] : 'pending';
  }
  // Late → Present / Absent while a round runs: resolve it in the current round (pending court plays
  // or lapses) and regenerate only the later suggested rounds. Other changes regenerate all drafts.
  function setStatus(memberIds, status) {
    const ids = new Set(memberIds);
    const idx = S.editableIndex(state.rounds || []);
    const round = state.started ? state.rounds[idx] : null;
    const resolving = round && (status === 'present' || status === 'absent') &&
      S.undecidedLate(round).some(id => ids.has(id));
    state.players.forEach(p => { if (ids.has(p.id)) p.status = status; });
    if (!resolving) return regenerate();
    state.rounds = state.rounds.slice();
    state.rounds[idx] = S.resolveLate(round, memberIds, status);
    state.rounds = S.scheduleState(state, null, idx + 1);
  }
  // Units (player, or team) having a member among ids.
  function unitsWith(ids) {
    return state.groups.flatMap(g => S.unitsForGroup(state, g.id)).filter(u => u.members.some(id => ids.includes(id)));
  }
  function markAllPresent(gid) {
    state.players.forEach(p => { if (p.groupId === gid && (p.status || 'present') === 'pending') p.status = 'present'; });
    regenerate();
  }
  function renamePlayer(pid, name) {
    name = norm(name);
    if (!name) return setNotice('error', T('err.nameEmpty'));
    name = N.capitalise(name);
    if (nameTaken(name, pid)) return setNotice('error', T('err.nameTaken', { name }));
    playerMap().get(pid).name = name;
  }
  function removeUnit(unitId) {
    const team = isTeams() ? state.teams.find(t => t.id === unitId) : null;
    const ids = team ? team.playerIds : [unitId];
    if (ids.some(inConfirmedRound)) {
      return setNotice('error', T('err.removePlayed'));
    }
    state.players = state.players.filter(p => !ids.includes(p.id));
    state.teams = state.teams.filter(t => t.id !== unitId);
    regenerate();
  }
  function setClubCourts(n) {
    n = Math.max(1, Math.min(40, Math.floor(n) || 1));
    state.clubCourts = n;
    state.courts = state.courts.filter(c => c <= n);
    if (state.courtMap) for (const c of Object.keys(state.courtMap)) if (+c > n) delete state.courtMap[c];
    regenerate();
  }
  function setCourts(list) { state.courtMap = null; state.courts = list.slice().sort((a, b) => a - b); regenerate(); }
  function toggleCourt(c) {
    setCourts(state.courts.includes(c) ? state.courts.filter(x => x !== c) : state.courts.concat(c));
  }
  function setOverride(gid, val) {
    const g = state.groups.find(x => x.id === gid);
    g.courtsOverride = val === '' ? null : Math.max(0, Math.floor(+val) || 0);
    regenerate();
  }
  function setRounds(val) {
    const min = state.started ? Math.max(1, S.confirmedPrefix(state.rounds).length) : 1;
    const n = Math.floor(+val);
    if (!(n >= min) || n > 50) return setNotice('error', T('err.roundsRange', { min }));
    state.numRounds = n;
    regenerate();
  }
  // Compact view: each group a different random colour from the theme's compactPalette (seeded),
  // stored in group.color (saved, exported). The floorplan uses court colours instead.
  function pickCompactColors(seed) {
    const palette = THEME.compactPalette && THEME.compactPalette.length ? THEME.compactPalette : COLORS;
    S.pickGroupColors(palette, state.groups.length, seed).forEach((c, i) => { state.groups[i].color = c; });
  }
  function shuffleColors() {
    const before = state.groups.map(g => g.color).join();
    for (let i = 0; i < 10 && state.groups.map(g => g.color).join() === before; i++) pickCompactColors(newSeed() + i);
  }
  function start() {
    const errs = startErrors();
    if (errs.length) return setNotice('error', errs.join(' '));
    state.courtAssignment = allocation().assignment;
    state.seed = newSeed();
    pickCompactColors(state.seed);
    state.started = true;
    state.rounds = S.scheduleState(state);
    state.ui.tab = 'rounds';
    state.ui.roundIdx = 0;
  }
  function restart() {
    if (!confirm(T('confirm.restart'))) return;
    state = S.restartTournament(state);
    state.ui.roundIdx = 0;
    editing = false; selected = null;
    setNotice('info', T('info.restarted'));
  }
  function newTournament() {
    if (!confirm(T('confirm.newTournament'))) return;
    const ui = state.ui;
    state = defaultState();
    state.ui.rankFilter = ui.rankFilter;
    editing = false; selected = null;
  }
  function loadDemo() {
    if (state.players.length && !confirm(T('confirm.loadDemo'))) return;
    const ui = state.ui;
    state = defaultState();
    state.ui = Object.assign(ui, { tab: 'setup', roundIdx: 0 });
    state.groups = [
      { id: newId('g'), name: T('demo.advanced'), color: COLORS[0], courtsOverride: null },
      { id: newId('g'), name: T('demo.beginner'), color: COLORS[1], courtsOverride: null },
    ];
    DEMO_NAMES.forEach((n, i) => { addPlayer(state.groups[i < 21 ? 0 : 1].id, n).status = 'present'; });
    state.clubCourts = 9;
    state.courts = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    state.numRounds = 6;
    setNotice('info', T('info.demoLoaded'));
  }

  // ---------- Views ----------
  const views = {};
  const section = (title, ...children) => el('section', { class: 'card' }, el('h2', {}, title), ...children);
  const help = key => el('p', { class: 'help' }, T(key));

  // locked: players read-only; groupLocked: group cannot be removed. Check-in chips stay usable.
  function groupCard(g, locked, groupLocked) {
    const pm = playerMap();
    const units = S.unitsForGroup(state, g.id);
    const ta = el('textarea', {
      rows: 4,
      placeholder: T(isTeams() ? 'setup.pasteTeams' : 'setup.pastePlayers'),
      oninput: e => { pasteDrafts[g.id] = e.target.value; },
    });
    ta.value = pasteDrafts[g.id] || '';
    const file = el('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv,text/plain', hidden: true,
      onchange: e => { if (e.target.files[0]) importFile(g.id, e.target.files[0]); } });
    const errRows = (pasteErrors[g.id] || []).map((r, i) => el('div', { class: 'paste-err' },
      el('span', { class: 'paste-line' }, r.line),
      el('span', { class: 'paste-why' }, T('paste.' + r.reason, { name: r.dup || '' })),
      r.suggestion ? el('button', { onclick: () => act(() => addAs(g.id, i)) },
        T('paste.addAs', { name: r.suggestion.join(' / ') })) : null));

    const counts = {};
    units.forEach(u => { const st = unitStatus(u); counts[st] = (counts[st] || 0) + 1; });
    const q = searches[g.id] || '';
    const matches = (u, text) => !text || u.members.some(id => N.key(pm.get(id).name).includes(N.key(text)));
    const rows = units.map(u => {
      const st = unitStatus(u);
      const from = u.members.map(id => pm.get(id).absentFromRound).filter(x => x != null);
      const row = el('div', { class: 'check-row st-' + st + (from.length ? ' absent' : ''), style: matches(u, q) ? null : 'display:none',
        title: from.length ? T('setup.absentFrom', { n: Math.min(...from) + 1 }) : null },
        u.members.map(pid => el('input', { class: 'check-name', value: pm.get(pid).name, disabled: locked,
          onchange: e => act(() => renamePlayer(pid, e.target.value)) })),
        el('div', { class: 'st-chips' }, STATUSES.map(x => el('button', {
          class: 'st-chip st-' + x + (st === x ? ' on' : ''),
          onclick: () => act(() => setStatus(u.members, x)),
        }, T('status.' + x)))),
        locked ? el('span') : el('button', { class: 'x', title: T('common.remove'), onclick: () => act(() => removeUnit(u.id)) }, '×'));
      row._unit = u;
      return row;
    });
    const list = el('div', { class: 'checklist' + (isTeams() ? ' teams' : '') },
      isTeams() ? el('div', { class: 'check-head' },
        el('span', {}, T('setup.player1')), el('span', {}, T('setup.player2')), el('span', {}, T('setup.status')), el('span')) : null,
      rows);

    return el('div', { class: 'group', style: gStyle(g.color) },
      el('div', { class: 'group-head' },
        el('span', { class: 'swatch' }),
        el('input', { class: 'group-name', value: g.name, disabled: locked, onchange: e => act(() => renameGroup(g.id, e.target.value)) }),
        el('span', { class: 'muted' }, `${units.length} ${unitWord()}`),
        groupLocked ? null : el('button', { class: 'link danger', onclick: () => act(() => removeGroup(g.id)) }, T('setup.removeGroup'))),
      locked ? null : el('div', { class: 'paste' }, ta,
        el('div', { class: 'row' },
          el('button', { onclick: () => act(() => addLines(g.id, ta.value)) }, T(isTeams() ? 'setup.addTeams' : 'setup.addPlayers')),
          el('button', { class: 'link', title: T('paste.importTitle'), onclick: () => file.click() }, T('paste.import')), file),
        errRows.length ? el('div', { class: 'paste-errs' }, errRows) : null),
      units.length ? el('div', { class: 'check-tools' },
        el('input', { type: 'search', class: 'check-search', placeholder: T('setup.search'), value: q,
          oninput: e => {
            searches[g.id] = e.target.value;
            rows.forEach(r => { r.style.display = matches(r._unit, e.target.value) ? '' : 'none'; });
          } }),
        el('button', { disabled: !counts.pending, onclick: () => act(() => markAllPresent(g.id)) }, T('setup.markAll')),
        el('span', { class: 'muted check-counts' },
          STATUSES.filter(x => counts[x]).map(x => `${T('status.' + x)} ${counts[x]}`).join(' · '))) : null,
      units.length ? list : null);
  }

  function allocationTable(locked) {
    const alloc = locked ? null : allocation();
    const rows = state.groups.map(g => {
      const size = S.scheduledUnits(state, g.id).length;
      const courts = locked ? (state.courtAssignment[g.id] || []) : (alloc.assignment[g.id] || []);
      const load = S.groupLoad(size, courts.length, state.mode);
      return el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: gStyle(g.color) }), g.name),
        el('td', { class: 'num' }, String(size)),
        el('td', { class: 'num' }, String(courts.length)),
        locked ? null : el('td', {}, el('input', {
          type: 'number', min: 0, class: 'small', value: g.courtsOverride, placeholder: T('alloc.auto'), disabled: !!state.courtMap,
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
          ['alloc.group', isTeams() ? 'unit.Teams' : 'unit.Players', 'alloc.courts', locked ? null : 'alloc.override',
            'alloc.courtNumbers', 'alloc.playing', 'alloc.resting'].filter(Boolean).map(h => el('th', {}, T(h))))),
        el('tbody', {}, rows)),
      idle.length ? el('p', { class: 'muted' }, T('alloc.unused', { list: idle.join(', ') })) : null,
      !locked ? el('p', { class: 'muted' }, T('alloc.hint')) : null);
  }

  // Setup floorplan: courts coloured by group; click to assign (default: contiguous automatic allocation).
  function setupFloor(fp, locked) {
    const assign = locked ? state.courtAssignment : allocation().assignment;
    const groupOf = {};
    state.groups.forEach(g => (assign[g.id] || []).forEach(c => { groupOf[c] = g; }));
    return el('div', {},
      floorGrid(fp, n => {
        const g = groupOf[n];
        const atClub = n <= state.clubCourts;
        return el('button', {
          class: 'fcourt setup' + (g ? '' : ' unused'), style: g ? gStyle(g.color) : null,
          disabled: locked || !atClub, onclick: () => act(() => clickCourt(n)),
        }, el('strong', {}, T('court.n', { n })),
        el('span', {}, !atClub ? T('floor.notAtClub') : g ? g.name : T('floor.unused')));
      }, 'setup-floor'),
      locked ? null : el('p', { class: 'muted' }, T('alloc.floorHint')),
      !locked && state.courtMap ? el('p', { class: 'row' }, el('span', { class: 'muted' }, T('alloc.manual')),
        el('button', { class: 'link', onclick: () => act(() => setCourts(state.courts)) }, T('alloc.autoBtn'))) : null);
  }

  views.setup = () => {
    const locked = courtsLocked();
    const pLocked = setupLocked();
    const nConf = confirmedCount();
    const errs = startErrors();
    const wrap = el('div', { class: 'setup' });
    if (state.started) {
      const why = !editing ? T('banner.locked')
        : nConf ? T(nConf > 1 ? 'banner.lockedConfirmedN' : 'banner.lockedConfirmed1', { n: nConf }) + T('banner.lockedRest')
        : T('banner.free');
      wrap.append(el('div', { class: 'banner' },
        el('div', {}, el('strong', {}, T('banner.running')), el('span', { class: 'muted' }, ' — ' + why)),
        el('div', { class: 'row' },
          el('button', { class: editing ? 'primary' : '', disabled: editing && !nConf && errs.length > 0,
            title: editing && !nConf && errs.length ? T('banner.fixErrors') : null,
            onclick: () => act(() => { editing = !editing; }) }, T(editing ? 'banner.done' : 'banner.edit')),
          el('button', { onclick: () => act(restart) }, T('banner.restart')),
          el('button', { class: 'danger', onclick: () => act(newTournament) }, T('banner.new')))));
    }
    if (notice) wrap.append(el('div', { class: 'notice ' + notice.kind }, notice.text));

    const modeBtn = (m, label, sub) => el('button', {
      class: 'opt' + (state.mode === m ? ' active' : ''), disabled: locked && state.mode !== m,
      onclick: () => act(() => setMode(m)),
    }, el('strong', {}, label), el('span', {}, sub));
    wrap.append(section(T('setup.mode'), help('help.mode'), el('div', { class: 'opts' },
      modeBtn('americano', T('mode.americano'), T('mode.americanoSub')),
      modeBtn('teams', T('mode.teams'), T('mode.teamsSub')))));

    wrap.append(section(T('setup.players'), help('help.players'),
      el('p', { class: 'muted' }, T('setup.groupsHint')),
      el('div', { class: 'groups' }, state.groups.map(g => groupCard(g, pLocked, locked))),
      !locked && state.groups.length < 4 ? el('button', { onclick: () => act(addGroup) }, T('setup.addGroup')) : null));

    const courtNos = Array.from({ length: state.clubCourts || 0 }, (_, i) => i + 1);
    wrap.append(section(T('setup.courts'), help('help.courts'),
      el('div', { class: 'row' },
        el('label', {}, T('setup.clubCourts'),
          el('input', { type: 'number', min: 1, max: 40, class: 'small', value: state.clubCourts, disabled: locked,
            onchange: e => act(() => setClubCourts(+e.target.value)) })),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => setCourts(courtNos)) }, T('setup.selectAll')),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => setCourts([])) }, T('setup.selectNone'))),
      floorplan() ? setupFloor(floorplan(), locked) : el('div', { class: 'court-toggles' }, courtNos.map(c => el('button', {
        class: 'court-btn' + (state.courts.includes(c) ? ' on' : ''), disabled: locked,
        title: T('court.n', { n: c }), onclick: () => act(() => toggleCourt(c)),
      }, String(c)))),
      state.groups.length ? allocationTable(locked) : null));

    wrap.append(section(T('setup.rounds'), help('help.rounds'),
      el('label', {}, T('setup.numRounds'),
        el('input', { type: 'number', min: 1, max: 50, class: 'small', value: state.numRounds, disabled: pLocked,
          onchange: e => act(() => setRounds(e.target.value)) }))));

    if (state.started) {
      wrap.append(section(T('setup.start'), help('help.start'),
        !nConf && errs.length ? el('ul', { class: 'errors' }, errs.map(e => el('li', {}, e))) : null,
        el('p', {}, T('setup.runningInfo', { rounds: state.rounds.length, confirmed: nConf })),
        el('button', { class: 'primary', onclick: () => act(() => { state.ui.tab = 'rounds'; }) }, T('setup.goRounds'))));
    } else {
      wrap.append(section(T('setup.start'), help('help.start'),
        errs.length ? el('ul', { class: 'errors' }, errs.map(e => el('li', {}, e))) : null,
        notCheckedIn() ? el('div', { class: 'notice warn' }, T('start.notChecked', { n: notCheckedIn(), unit: unitWord() })) : null,
        el('div', { class: 'row' },
          el('button', { class: 'primary', disabled: errs.length > 0, onclick: () => act(start) }, T('setup.startBtn')),
          el('button', { onclick: () => act(loadDemo) }, T('setup.loadDemo')))));
    }
    return wrap;
  };

  function goRound(i) {
    state.ui.roundIdx = Math.max(0, Math.min(i, state.rounds.length - 1));
    selected = null; notice = null;
    save(); render();
  }

  // ---------- Current-round editing ----------
  const teamOf = pid => state.teams.find(t => t.playerIds.includes(pid));
  const sameUnit = (a, b) => a === b || (isTeams() && teamOf(a) != null && teamOf(a) === teamOf(b));

  function pick(pid) {
    if (!selected || sameUnit(selected, pid)) { selected = selected ? null : pid; notice = null; render(); return; }
    const res = S.swapPlayers(state, state.ui.roundIdx, selected, pid);
    act(() => {
      if (res.error) { setNotice('error', res.error); selected = pid; return; }
      state.rounds = res.rounds;
      selected = null;
    });
  }
  function renameSelected() {
    const p = playerMap().get(selected);
    const n = prompt(T('prompt.rename', { name: p.name }), p.name);
    if (n != null) act(() => renamePlayer(p.id, n));
  }
  function replaceSelected(idx) {
    const old = playerMap().get(selected);
    const raw = prompt(T('prompt.replace', { name: old.name, n: idx + 1 }));
    if (raw == null) return;
    act(() => {
      const n = norm(raw);
      if (!n) return setNotice('error', T('err.nameEmpty'));
      if (nameTaken(n)) return setNotice('error', T('err.nameTaken', { name: n }));
      const p = addPlayer(old.groupId, n);
      old.absentFromRound = idx;
      const sub = ids => ids.map(id => (id === old.id ? p.id : id));
      const r = state.rounds[idx];
      r.matches.forEach(m => { m.teamA = sub(m.teamA); m.teamB = sub(m.teamB); });
      r.resting = sub(r.resting);
      state.rounds = S.scheduleState(state, null, idx + 1); // keep this round, redo the later ones
      selected = null;
      setNotice('info', T('info.replaced', { new: n, old: old.name, n: idx + 1 }));
    });
  }
  function absentSelected(idx) {
    const p = playerMap().get(selected);
    const who = isTeams() ? teamOf(p.id).playerIds.map(id => playerMap().get(id).name).join(' / ') : p.name;
    if (!confirm(T('confirm.absent', { who, n: idx + 1 }))) return;
    act(() => {
      p.absentFromRound = idx;
      state.rounds = S.scheduleState(state);
      selected = null;
    });
  }
  // Confirm with late players still undecided: one choice per late unit, default "Absent (match lapses)".
  // Confirm dialog: "Confirm Round N? The lineup will be locked." plus one choice per Late player still
  // undecided (default "Absent (match lapses)", alternative "Present").
  function confirmCurrent(idx) {
    const late = unitsWith(S.undecidedLate(state.rounds[idx]));
    const pm = playerMap();
    const dlg = el('dialog', { class: 'late-dialog' });
    const choices = late.map(u => {
      const name = u.members.map(id => pm.get(id).name).join(' / ');
      const sel = el('select', {},
        el('option', { value: 'absent' }, T('late.absent')),
        el('option', { value: 'present' }, T('late.present')));
      return { u, sel, row: el('label', { class: 'late-row' }, el('strong', {}, name), sel) };
    });
    const close = () => { dlg.close(); dlg.remove(); };
    const ok = el('button', { class: 'primary', onclick: () => {
      const picked = choices.map(c => [c.u.members, c.sel.value]);
      close();
      if (picked.length) act(() => picked.forEach(([ids, v]) => setStatus(ids, v)));
      doConfirm(idx);
    } }, T('confirm.btn'));
    // el() skips null children (native append() would print "null").
    dlg.append(el('div', {}, el('h3', {}, T('confirm.round', { n: idx + 1 })),
      choices.length ? el('p', { class: 'muted' }, T('late.title', { n: idx + 1 })) : null, choices.map(c => c.row),
      el('div', { class: 'row' }, ok, el('button', { onclick: close }, T('common.cancel')))));
    dlg.addEventListener('cancel', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    ok.focus();
  }
  function unlockCurrent(idx) {
    if (!confirm(T('confirm.unlock', { n: idx + 1 }))) return;
    act(() => {
      const res = S.unlockRound(state, idx);
      if (res.error) return setNotice('error', res.error);
      state.rounds = res.rounds;
      selected = null;
    });
  }
  function doConfirm(idx) {
    act(() => {
      const res = S.confirmRound(state, idx);
      if (res.error) return setNotice('error', res.error);
      state.rounds = res.rounds;
      selected = null;
      state.ui.roundIdx = Math.min(idx + 1, state.rounds.length - 1);
    });
  }
  function regenerateSuggestion() {
    act(() => {
      state.seed = newSeed();
      state.rounds = S.scheduleState(state);
      selected = null;
    });
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
  }

  // Score fields of the shown round, in keyboard order (court by court, team A then B). Rebuilt per render.
  let scoreFields = [];
  function focusField(i) {
    const f = scoreFields[Math.max(0, Math.min(i, scoreFields.length - 1))];
    if (f) { f.inp.focus(); f.inp.select(); }
  }
  // Games per side: empty or a non-negative integer. Saved on every keystroke without re-render.
  // Enter / Tab / → / ↓ = next field, Shift+Tab / ← / ↑ = previous; auto-advance after a complete entry.
  function scoreInput(m, key, label, onChange) {
    const inp = el('input', { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', class: 'score',
      'aria-label': label, value: m[key] == null ? '' : m[key] });
    const field = { m, key, inp };
    scoreFields.push(field);
    const index = () => scoreFields.indexOf(field);
    inp.addEventListener('input', () => {
      const raw = inp.value.trim();
      const ok = raw === '' || /^\d{1,3}$/.test(raw);
      inp.classList.toggle('invalid', !ok);
      m[key] = ok && raw !== '' ? Number(raw) : null;
      save();
      if (onChange) onChange();
      if (ok && R.autoAdvance(raw) && index() < scoreFields.length - 1) focusField(index() + 1);
    });
    inp.addEventListener('keydown', e => {
      const next = e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey);
      const prev = e.key === 'ArrowUp' || e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey);
      if (!next && !prev) return;
      const i = index() + (next ? 1 : -1);
      if (i < 0 || i >= scoreFields.length) { if (e.key !== 'Tab') e.preventDefault(); return; } // Tab leaves the list
      e.preventDefault();
      focusField(i);
    });
    inp.addEventListener('focus', () => inp.select());
    return inp;
  }

  views.rounds = () => {
    if (!state.started || !state.rounds.length) {
      return el('div', { class: 'card empty' }, T('rounds.empty'));
    }
    const idx = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[idx];
    const pm = playerMap();
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const name = id => (pm.get(id) || { name: '?' }).name;
    const label = r => T(r.status === 'confirmed' ? 'status.confirmed' : 'status.draft');
    scoreFields = [];
    const found = foundIds(); // Find player search → highlighted on the court cards

    const editIdx = S.editableIndex(state.rounds);
    const editable = idx === editIdx && round.status === 'draft';
    const isSel = id => selected != null && sameUnit(selected, id);
    // Names fit the card (see fitNames): shrink first, then last part as initial; full name on hover/tap.
    const nameAttrs = id => ({ title: name(id), 'data-full': name(id), 'data-short': N.shortName(name(id)) });
    const pname = (id, cls) => (editable
      ? el('button', Object.assign(nameAttrs(id), { class: `pname nm ${cls || ''}${isSel(id) ? ' sel' : ''}${found.has(id) ? ' found' : ''}`, onclick: () => pick(id) }), name(id))
      : el('span', Object.assign(nameAttrs(id), { class: 'nm ' + (cls || '') + (found.has(id) ? ' found' : ''), onclick: tapFull }), name(id)));
    const fp = floorplan();
    const viewMode = fp && state.ui.roundsView !== 'compact' ? 'floorplan' : 'compact';

    const bar = el('div', { class: 'round-bar' },
      el('button', { class: 'link back', onclick: () => act(() => { state.ui.tab = 'setup'; }) }, T('rounds.back')),
      el('button', { class: 'nav', disabled: idx === 0, title: T('rounds.prev'), 'aria-label': T('rounds.prevAria'), onclick: () => goRound(idx - 1) }, '‹'),
      el('div', { class: 'pills' }, state.rounds.map((r, i) => el('button', {
        class: `pill ${r.status}${i === idx ? ' active' : ''}`, title: T('rounds.pill', { n: i + 1, status: label(r) }),
        onclick: () => goRound(i),
      }, String(i + 1)))),
      el('button', { class: 'nav next', disabled: idx === state.rounds.length - 1, title: T('rounds.nextTitle'), onclick: () => goRound(idx + 1) }, T('rounds.next')),
      fp ? el('div', { class: 'seg' }, ['compact', 'floorplan'].map(v => el('button', {
        class: viewMode === v ? 'active' : '', onclick: () => act(() => { state.ui.roundsView = v; }),
      }, T('view.' + v)))) : null,
      viewMode === 'compact' ? el('button', { onclick: () => act(shuffleColors) }, T('rounds.shuffleColours')) : null,
      el('button', { class: 'fs-btn', onclick: toggleFullscreen }, T(document.fullscreenElement ? 'rounds.exitFullscreen' : 'rounds.fullscreen')));

    const title = el('h2', { class: 'round-title' }, T('rounds.title', { n: idx + 1, total: state.rounds.length }),
      el('span', { class: 'badge ' + round.status }, label(round)));

    // Scores only in confirmed rounds; names are clickable only in the current (editable) round.
    const resultRows = new Map(); // match → {scoreA: row, scoreB: row} for the live winner highlight
    const team = (m, key, label) => {
      const ids = m[key === 'scoreA' ? 'teamA' : 'teamB'];
      const isLate = id => m.pending && m.late.includes(id);
      const rows = resultRows.get(m) || resultRows.set(m, {}).get(m);
      const refresh = () => ['scoreA', 'scoreB'].forEach(k => {
        if (rows[k]) rows[k].className = 'team-row ' + R.resultClass(m, k);
      });
      const row = rows[key] = el('div', { class: 'team-row ' + R.resultClass(m, key) },
        el('div', { class: 'tnames', title: ids.map(name).join(' / ') },
          ids.map((id, i) => [i ? ' / ' : null,
            isLate(id) && viewMode === 'floorplan'
              ? el('span', Object.assign(nameAttrs(id), { class: 'late-slot nm', onclick: tapFull }), T('rounds.lateSlot', { name: name(id) }))
              : isLate(id) ? el('span', Object.assign(nameAttrs(id), { class: 'nm', onclick: tapFull }), name(id)) : pname(id)])),
        round.status === 'confirmed' ? scoreInput(m, key, label, refresh) : null);
      return row;
    };


    let tools = null;
    if (editable) {
      const sp = selected && playerMap().get(selected);
      tools = el('div', { class: 'edit-tools' },
        el('div', { class: 'row' },
          el('button', { class: 'primary', onclick: () => confirmCurrent(idx) }, T('rounds.confirm', { n: idx + 1 })),
          el('button', { onclick: regenerateSuggestion }, T('rounds.regenerate')),
          el('span', { class: 'muted' }, T('rounds.editHint'))),
        sp ? el('div', { class: 'row sel-bar' },
          el('span', {}, T('rounds.selected'), el('strong', {}, isTeams() ? teamOf(sp.id).playerIds.map(name).join(' / ') : sp.name)),
          el('button', { onclick: renameSelected }, T('rounds.renameSel', { name: sp.name })),
          isTeams() ? null : el('button', { onclick: () => replaceSelected(idx) }, T('rounds.replace')),
          el('button', { class: 'danger', onclick: () => absentSelected(idx) }, T(isTeams() ? 'rounds.absentTeam' : 'rounds.absent')),
          el('button', { class: 'link', onclick: () => { selected = null; render(); } }, T('common.cancel'))) : null);
    } else if (round.status === 'draft') {
      tools = el('p', { class: 'muted' }, T('rounds.suggestedOnly', { n: editIdx + 1 }));
    } else if (idx === confirmedCount() - 1) {
      tools = el('div', { class: 'edit-tools' }, el('div', { class: 'row' },
        el('button', { class: 'link danger', onclick: () => unlockCurrent(idx) }, T('rounds.unlock'))));
    }
    const msg = notice && state.ui.tab === 'rounds' ? el('div', { class: 'notice ' + notice.kind }, notice.text) : null;

    const uname = u => u.members.map(name).join(' / ');
    const lateButtons = (m, short) => (m.pending && editable ? el('div', { class: 'late-actions' }, unitsWith(m.late).map(u => [
      el('button', { onclick: () => act(() => setStatus(u.members, 'present')) }, short ? T('rounds.present') : T('rounds.arrived', { name: uname(u) })),
      el('button', { class: 'danger', onclick: () => act(() => setStatus(u.members, 'absent')) }, short ? T('rounds.absentBtn') : T('rounds.lateAbsent', { name: uname(u) })),
    ])) : null);
    // Floorplan: every court on its grid position; pending court striped; courts without a match grey "Unused".
    const byCourt = new Map(round.matches.map(m => [m.court, m]));
    const courtColors = fp && fp.courtColors || {};
    const floorCards = () => floorGrid(fp, n => {
      const m = byCourt.get(n);
      const cc = courtColors[n];
      if (!m) {
        // Unused: light greyish tint (~25% court colour on light grey).
        const tint = cc ? mixHex(cc, cssVar('--line'), 0.25) : null;
        return el('div', { class: 'fcourt unused' + (tint ? ' tinted' : ''), style: tint ? gStyle(tint) : null },
          el('div', { class: 'fcourt-head' }, T('court.n', { n })), el('div', { class: 'fcourt-unused' }, T('floor.unused')));
      }
      const g = gm.get(m.groupId) || { name: '', color: null };
      return el('div', { class: 'fcourt court' + (m.pending ? ' pending' : ''), style: gStyle(cc || g.color) },
        el('div', { class: 'fcourt-head' }, T('court.n', { n }),
          el('span', { class: 'group-badge', style: gStyle(g.color) }, g.name)),
        team(m, 'scoreA', T('rounds.teamA')), el('div', { class: 'vs' }, T('rounds.vs')), team(m, 'scoreB', T('rounds.teamB')),
        lateButtons(m, true));
    }, 'rounds-floor' + (round.status === 'draft' ? ' draft' : ''));
    const cards = viewMode === 'floorplan' ? floorCards() : el('div', { class: 'courts' + (round.status === 'draft' ? ' draft' : '') }, round.matches.map(m => {
      const g = gm.get(m.groupId) || { name: '', color: null };
      const lateUnits = m.pending ? unitsWith(m.late) : [];
      return el('div', { class: 'court' + (m.pending ? ' pending' : ''), style: gStyle(g.color) },
        el('div', { class: 'court-head' }, T('rounds.court', { n: m.court, group: g.name })),
        m.pending ? el('div', { class: 'waiting' }, T('rounds.waitingFor', { names: lateUnits.map(uname).join(', ') })) : null,
        team(m, 'scoreA', T('rounds.teamA')), el('div', { class: 'vs' }, T('rounds.vs')), team(m, 'scoreB', T('rounds.teamB')),
        lateButtons(m, false));
    }));
    const order = R.scoreOrder(round.matches).map(o => o.court + o.key);
    scoreFields.sort((a, b) => order.indexOf(a.m.court + a.key) - order.indexOf(b.m.court + b.key));
    const lapsed = (round.lapsed || []).map(c => el('p', { class: 'muted' }, T('rounds.lapsed', { n: c })));

    const inGroup = (list, g) => (list || []).filter(id => (pm.get(id) || {}).groupId === g.id).sort((a, b) => name(a).localeCompare(name(b)));
    const groupsResting = state.groups.map(g => ({ g, ids: inGroup(round.resting, g), late: inGroup(round.late, g) }))
      .filter(x => x.ids.length || x.late.length);
    // Late players not on a court wait here: no rest credit. Click (current round) to resolve them.
    const lateChip = id => (editable
      ? el('button', { class: 'chip late', title: T('rounds.arrived', { name: name(id) }),
        onclick: () => act(() => setStatus(unitsWith([id])[0].members, 'present')) }, name(id), el('small', {}, ' ' + T('rounds.lateLabel')))
      : el('span', { class: 'chip late' }, name(id), el('small', {}, ' ' + T('rounds.lateLabel'))));
    const resting = el('div', { class: 'resting' }, el('h3', {}, T('rounds.resting')),
      groupsResting.length ? groupsResting.map(({ g, ids, late }) => el('div', { class: 'rest-group', style: gStyle(g.color) },
        el('span', { class: 'rest-label' }, g.name),
        ids.map(id => pname(id, 'chip')), late.map(lateChip))) : el('p', { class: 'muted' }, T('rounds.nobodyRests')));

    return el('div', { class: 'rounds' }, bar, title, msg, tools, lapsed, cards, resting);
  };

  const notStarted = () => el('div', { class: 'card empty' }, T('rounds.empty'));

  let findQuery = '';         // Find player search text (not persisted)
  // Players matching the Find search (case/space-insensitive); empty search → none.
  function foundIds() {
    const q = N.key(findQuery);
    return new Set(q ? state.players.filter(p => N.key(p.name).includes(q)).map(p => p.id) : []);
  }
  // Colour dots, one per round: green played, red rested, grey absent; pale = suggested.
  function dots(pid) {
    return el('span', { class: 'dots' }, R.roundDots(state.rounds, pid).map((d, i) => el('span', {
      class: `dot ${d.kind}${d.suggested ? ' suggested' : ''}`,
      title: T('dot.' + d.kind, { n: i + 1 }) + (d.suggested ? T('dot.suggested') : ''),
    })));
  }

  // Where is each player in the round selected on the Rounds tab. Click → that round, player highlighted.
  views.find = () => {
    if (!state.started || !state.rounds.length) return notStarted();
    const ci = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[ci];
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const where = new Map();
    round.matches.forEach(m => m.teamA.concat(m.teamB).forEach(id => where.set(id, T('court.n', { n: m.court }))));
    round.resting.forEach(id => where.set(id, null));
    (round.late || []).forEach(id => where.set(id, T('find.late')));
    round.matches.filter(m => m.pending).forEach(m => m.late.forEach(id => where.set(id, T('find.late') + ' · ' + T('court.n', { n: m.court }))));
    const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name));
    const items = players.map(p => {
      const court = where.get(p.id);
      const w = court || T(where.has(p.id) ? 'find.resting' : 'find.absent');
      const item = el('button', { class: 'find-item', style: gStyle((gm.get(p.groupId) || {}).color),
        onclick: () => act(() => { findQuery = p.name; state.ui.tab = 'rounds'; }) },
        el('span', { class: 'find-name' }, p.name),
        dots(p.id),
        el('span', { class: 'find-where' + (court ? '' : ' off') }, w));
      return { item, key: N.key(p.name) };
    });
    const empty = el('p', { class: 'muted' }, T('find.noMatch'));
    // Filter in place so the search box keeps focus while typing.
    const apply = () => {
      const q = N.key(findQuery);
      let shown = 0;
      for (const { item, key } of items) { const ok = key.includes(q); item.hidden = !ok; shown += ok; }
      empty.hidden = shown > 0;
    };
    const search = el('input', { type: 'search', class: 'find-search', placeholder: T('find.search'),
      'aria-label': T('find.searchAria'), value: findQuery });
    search.addEventListener('input', () => { findQuery = search.value; apply(); });
    apply();
    setTimeout(() => search.focus(), 0);
    return el('div', { class: 'find' },
      el('h2', { class: 'round-title' }, T('find.round', { n: ci + 1 }),
        el('span', { class: 'badge ' + round.status }, T(round.status === 'confirmed' ? 'status.confirmed' : 'status.draft'))),
      search, empty,
      el('div', { class: 'find-list' }, items.map(x => x.item)));
  };

  function rankTable(title, color, rows) {
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const diff = d => (d > 0 ? '+' + d : String(d));
    const head = ['rank', isTeams() ? 'team' : 'name', 'group', 'rounds', 'played', 'rested', 'won', 'lost', 'diff', 'wdl', 'avg']
      .map(k => T('rank.' + k));
    return el('section', { class: 'card rank-card', style: gStyle(color) },
      el('h2', {}, color ? el('span', { class: 'swatch' }) : null, title),
      el('table', { class: 'rank' },
        el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i > 3 ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map(r => el('tr', {},
          el('td', { class: 'num' }, String(r.rank)),
          el('td', { class: 'rname' }, r.name),
          el('td', {}, el('span', { class: 'swatch', style: gStyle((gm.get(r.groupId) || {}).color) }), r.group),
          el('td', {}, dots(isTeams() ? (state.teams.find(t => t.id === r.id) || { playerIds: [r.id] }).playerIds[0] : r.id)),
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
    const bar = el('div', { class: 'row rank-bar' }, [['group', T('rank.perGroup')], ['all', T('rank.all')]].map(([k, label]) =>
      el('button', { class: f === k ? 'active' : '', onclick: () => act(() => { state.ui.rankFilter = k; }) }, label)));
    bar.append(el('button', { class: 'primary final-btn', onclick: () => { finalOpen = true; render(); } }, T('rank.final')));
    const tables = f === 'all'
      ? [rankTable(T('rank.allGroups'), null, R.computeRankings(state, null))]
      : state.groups.map(g => rankTable(g.name, g.color, R.computeRankings(state, g.id)));
    return el('div', { class: 'rankings' }, bar, tables, finalOpen ? finalStandings() : null);
  };

  // Full-screen projector overlay: per group, top 3 highlighted. Esc or ✕ closes.
  let finalOpen = false;
  function finalStandings() {
    const close = () => { finalOpen = false; render(); };
    const diff = d => (d > 0 ? '+' + d : String(d));
    const cols = state.groups.map(g => el('section', { class: 'fs-group', style: gStyle(g.color) },
      el('h2', {}, g.name),
      el('table', { class: 'fs-table' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'num' }, T('final.rank')), el('th', {}, T(isTeams() ? 'rank.team' : 'rank.name')),
          el('th', { class: 'num' }, T('rank.won')), el('th', { class: 'num' }, T('rank.diff')))),
        el('tbody', {}, R.computeRankings(state, g.id).map(r => el('tr', { class: r.rank <= 3 ? `top top${r.rank}` : '' },
          el('td', { class: 'num' }, String(r.rank)),
          el('td', { class: 'fs-name', title: r.name }, r.name),
          el('td', { class: 'num strong' }, String(r.won)),
          el('td', { class: 'num' }, diff(r.diff))))))));
    return el('div', { class: 'final-overlay', role: 'dialog', 'aria-label': T('rank.final') },
      el('div', { class: 'final-head' }, el('h1', {}, LOGOS.ring ? el('img', { class: 'ring', src: LOGOS.ring, alt: '' }) : null, T('rank.final')),
        el('button', { class: 'final-close', 'aria-label': T('final.close'), title: T('final.close'), onclick: close }, '✕')),
      el('div', { class: 'final-groups' }, cols));
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `padel-americano-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function importJson(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { return setNotice('error', T('err.importJson')); }
    if (!data || !Array.isArray(data.players) || !Array.isArray(data.groups) || !Array.isArray(data.rounds)) {
      return setNotice('error', T('err.importFormat'));
    }
    if (state.players.length && !confirm(T('confirm.import'))) return;
    const ui = Object.assign(defaultState().ui, data.ui, { tab: 'data' });
    state = Object.assign(defaultState(), data, { ui });
    editing = false; selected = null;
    setNotice('info', T('info.imported', { players: state.players.length, rounds: state.rounds.length }));
  }

  views.data = () => {
    const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true,
      onchange: e => { const f = e.target.files[0]; if (f) f.text().then(t => act(() => importJson(t))); } });
    return el('div', {},
      notice ? el('div', { class: 'notice ' + notice.kind }, notice.text) : null,
      section(T('data.title'),
        el('p', { class: 'muted' }, T('data.hint')),
        el('div', { class: 'row' },
          el('button', { onclick: exportJson }, T('data.export')),
          el('button', { onclick: () => file.click() }, T('data.import')), file,
          el('button', { class: 'danger', onclick: () => act(() => {
            if (!confirm(T('confirm.reset'))) return;
            state = defaultState(); state.ui.tab = 'data';
            editing = false; selected = null;
          }) }, T('data.reset')))),
      state.started && state.rounds.length ? section(T('data.fairness'),
        el('pre', { class: 'fair' }, S.formatFairness(S.fairnessReport(state)))) : null);
  };

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && finalOpen) { finalOpen = false; render(); return; }
    if (e.key === 'Escape' && selected) { selected = null; render(); return; }
    if (state.ui.tab !== 'rounds' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      goRound(state.ui.roundIdx + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });
  document.addEventListener('fullscreenchange', render);

  // ---------- Help ----------
  function modal(cls, ...children) {
    const dlg = el('dialog', { class: 'late-dialog ' + cls }, ...children);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    return dlg;
  }
  // "?" per screen: help for the current tab, plus the tour.
  function showHelp() {
    const dlg = modal('help-dialog', el('h3', {}, T('help.title') + ' — ' + T('tab.' + state.ui.tab)),
      el('p', {}, T('help.screen.' + state.ui.tab)),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => dlg.close() }, T('help.close')),
        el('button', { onclick: () => { dlg.close(); showTour(); } }, T('help.tour'))));
  }
  // First-run tour: 4 steps, skippable, shown once (flag in localStorage).
  const TOUR_KEY = 'padel-americano-tour-done';
  function showTour() {
    let step = 1;
    const total = 4;
    const body = el('div');
    const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { /* ignore */ } dlg.close(); };
    const draw = () => body.replaceChildren(
      el('p', { class: 'muted' }, T('tour.step', { n: step, total })),
      el('h3', {}, T('tour.title' + step)), el('p', {}, T('tour.text' + step)),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => { if (step < total) { step++; draw(); } else done(); } },
          T(step < total ? 'tour.next' : 'tour.done')),
        step < total ? el('button', { class: 'link', onclick: done }, T('tour.skip')) : null));
    const dlg = modal('tour-dialog', body);
    dlg.addEventListener('cancel', done);
    draw();
  }
  function maybeTour() {
    let seen = true;
    try { seen = !!localStorage.getItem(TOUR_KEY); } catch (e) { /* storage blocked: skip the tour */ }
    if (!seen) showTour();
  }

  function render() {
    renderTabs();
    const view = document.getElementById('view');
    const fn = views[state.ui.tab];
    view.replaceChildren(fn ? fn() : el('p', {}, ''));
    requestAnimationFrame(() => fitNames(view));
  }

  // Shrink a name line (down to 65%) until it fits; still too wide → names in short form.
  const nameText = (n, which) => (n.classList.contains('late-slot') ? T('rounds.lateSlot', { name: n.dataset[which] }) : n.dataset[which]);
  function fitNames(root) {
    root.querySelectorAll('.tnames').forEach(box => {
      box.style.fontSize = '';
      const names = box.querySelectorAll('.nm[data-short]');
      names.forEach(n => { delete n.dataset.fitted; n.textContent = nameText(n, 'full'); });
      if (box.scrollWidth <= box.clientWidth) return;
      const base = parseFloat(getComputedStyle(box).fontSize);
      for (let size = base - 1; size >= base * 0.65 && box.scrollWidth > box.clientWidth; size--) box.style.fontSize = size + 'px';
      if (box.scrollWidth > box.clientWidth) {
        names.forEach(n => { n.dataset.fitted = '1'; n.textContent = nameText(n, 'short'); });
      }
    });
  }
  // Tap a shortened name to toggle the full name.
  function tapFull(e) {
    const n = e.currentTarget;
    if (!n.dataset.fitted) return;
    n.textContent = n.textContent === nameText(n, 'full') ? nameText(n, 'short') : nameText(n, 'full');
  }
  let fitTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => fitNames(document.getElementById('view')), 100);
  });

  render();
  maybeTour();
})();
