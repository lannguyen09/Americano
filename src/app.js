/* Padel Americano — UI. Uses window.Scheduler (src/scheduler.js). */
(function () {
  'use strict';
  const STORAGE_KEY = 'padel-americano-v1';
  const T = window.Strings.t;
  const THEME = window.THEME || {};

  const TABS = ['setup', 'rounds', 'find', 'rankings', 'data'].map(id => [id, T('tab.' + id)]);

  // Header: title and logo from the theme (none in the generic build).
  (function applyTheme() {
    const title = THEME.title || T('app.title');
    document.title = title;
    const h1 = document.querySelector('.topbar h1');
    h1.textContent = title;
    const logo = THEME.logos && THEME.logos.wordmark;
    if (logo) {
      const img = document.createElement('img');
      img.className = 'logo'; img.src = logo; img.alt = THEME.clubName || '';
      h1.prepend(img);
    }
  })();

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
  const DEMO_NAMES = ('Anna Bram Carla Daan Eva Floris Gwen Hugo Iris Jesse Kim Lars Maud Niels Olga ' +
    'Pieter Quinty Ruben Sanne Tim Ursula Victor Wendy Xander Yara Zeno Amber Bas Chloe Dirk Elise Frank ' +
    'Gina Hans Ilse Joost Karin Luuk Mila Noah Odile Paul Rosa Sem Tess Thijs Vera Wout Yvonne Bart Celine ' +
    'Dennis Esther Finn Hanna Ivo Julia Koen Lotte Milan Nina Otto Pim Roos Sven Tara Vince Wim Zoe').split(' ');

  let notice = null;          // {kind: 'error'|'info', text}
  const pasteDrafts = {};     // textarea content per group id (not persisted)
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
    const k = norm(name).toLowerCase();
    return state.players.some(p => p.id !== exceptId && p.name.toLowerCase() === k);
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
  function allocation() {
    return S.allocateCourts(state.groups.map(g => ({
      id: g.id, name: g.name, size: S.unitsForGroup(state, g.id).length, override: g.courtsOverride,
    })), state.courts, state.mode);
  }
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
      const why = T(isTeams() ? 'paste.whyTeams' : 'paste.whyPlayers');
      setNotice('error', T('paste.skipped', { added, skipped: rejected.length, why }));
    } else if (added) setNotice('info', T('paste.added', { n: added, unit: unitWord() }));
    if (added) regenerate();
  }
  function renamePlayer(pid, name) {
    name = norm(name);
    if (!name) return setNotice('error', T('err.nameEmpty'));
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
    regenerate();
  }
  function setCourts(list) { state.courts = list.slice().sort((a, b) => a - b); regenerate(); }
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
  function start() {
    const errs = startErrors();
    if (errs.length) return setNotice('error', errs.join(' '));
    state.courtAssignment = allocation().assignment;
    state.seed = newSeed();
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
    DEMO_NAMES.forEach((n, i) => addPlayer(state.groups[i < 21 ? 0 : 1].id, n));
    state.clubCourts = 9;
    state.courts = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    state.numRounds = 6;
    setNotice('info', T('info.demoLoaded'));
  }

  // ---------- Views ----------
  const views = {};
  const section = (title, ...children) => el('section', { class: 'card' }, el('h2', {}, title), ...children);

  // locked: players read-only; groupLocked: group cannot be removed.
  function groupCard(g, locked, groupLocked) {
    const pm = playerMap();
    const units = S.unitsForGroup(state, g.id);
    const ta = el('textarea', {
      rows: 4,
      placeholder: T(isTeams() ? 'setup.pasteTeams' : 'setup.pastePlayers'),
      oninput: e => { pasteDrafts[g.id] = e.target.value; },
    });
    ta.value = pasteDrafts[g.id] || '';
    return el('div', { class: 'group', style: gStyle(g.color) },
      el('div', { class: 'group-head' },
        el('span', { class: 'swatch' }),
        el('input', { class: 'group-name', value: g.name, disabled: locked, onchange: e => act(() => renameGroup(g.id, e.target.value)) }),
        el('span', { class: 'muted' }, `${units.length} ${unitWord()}`),
        groupLocked ? null : el('button', { class: 'link danger', onclick: () => act(() => removeGroup(g.id)) }, T('setup.removeGroup'))),
      locked ? null : el('div', { class: 'paste' }, ta,
        el('button', { onclick: () => act(() => addLines(g.id, ta.value)) }, T(isTeams() ? 'setup.addTeams' : 'setup.addPlayers'))),
      el('div', { class: 'roster' }, units.map(u => el('div', { class: 'roster-item' + (u.absentFromRound != null ? ' absent' : ''),
        title: u.absentFromRound != null ? T('setup.absentFrom', { n: u.absentFromRound + 1 }) : null },
        u.members.map((pid, i) => [
          i ? el('span', { class: 'muted' }, '/') : null,
          el('input', { value: pm.get(pid).name, disabled: locked, onchange: e => act(() => renamePlayer(pid, e.target.value)) }),
        ]),
        locked ? null : el('button', { class: 'x', title: T('common.remove'), onclick: () => act(() => removeUnit(u.id)) }, '×')))));
  }

  function allocationTable(locked) {
    const alloc = locked ? null : allocation();
    const rows = state.groups.map(g => {
      const size = S.unitsForGroup(state, g.id).length;
      const courts = locked ? (state.courtAssignment[g.id] || []) : (alloc.assignment[g.id] || []);
      const load = S.groupLoad(size, courts.length, state.mode);
      return el('tr', {},
        el('td', {}, el('span', { class: 'swatch', style: gStyle(g.color) }), g.name),
        el('td', { class: 'num' }, String(size)),
        el('td', { class: 'num' }, String(courts.length)),
        locked ? null : el('td', {}, el('input', {
          type: 'number', min: 0, class: 'small', value: g.courtsOverride, placeholder: T('alloc.auto'),
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
    wrap.append(section(T('setup.mode'), el('div', { class: 'opts' },
      modeBtn('americano', T('mode.americano'), T('mode.americanoSub')),
      modeBtn('teams', T('mode.teams'), T('mode.teamsSub')))));

    wrap.append(section(T('setup.players'),
      el('p', { class: 'muted' }, T('setup.groupsHint')),
      el('div', { class: 'groups' }, state.groups.map(g => groupCard(g, pLocked, locked))),
      !locked && state.groups.length < 4 ? el('button', { onclick: () => act(addGroup) }, T('setup.addGroup')) : null));

    const courtNos = Array.from({ length: state.clubCourts || 0 }, (_, i) => i + 1);
    wrap.append(section(T('setup.courts'),
      el('div', { class: 'row' },
        el('label', {}, T('setup.clubCourts'),
          el('input', { type: 'number', min: 1, max: 40, class: 'small', value: state.clubCourts, disabled: locked,
            onchange: e => act(() => setClubCourts(+e.target.value)) })),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => setCourts(courtNos)) }, T('setup.selectAll')),
        locked ? null : el('button', { class: 'link', onclick: () => act(() => setCourts([])) }, T('setup.selectNone'))),
      el('div', { class: 'court-toggles' }, courtNos.map(c => el('button', {
        class: 'court-btn' + (state.courts.includes(c) ? ' on' : ''), disabled: locked,
        title: T('court.n', { n: c }), onclick: () => act(() => toggleCourt(c)),
      }, String(c)))),
      state.groups.length ? allocationTable(locked) : null));

    wrap.append(section(T('setup.rounds'),
      el('label', {}, T('setup.numRounds'),
        el('input', { type: 'number', min: 1, max: 50, class: 'small', value: state.numRounds, disabled: pLocked,
          onchange: e => act(() => setRounds(e.target.value)) }))));

    if (state.started) {
      wrap.append(section(T('setup.start'),
        !nConf && errs.length ? el('ul', { class: 'errors' }, errs.map(e => el('li', {}, e))) : null,
        el('p', {}, T('setup.runningInfo', { rounds: state.rounds.length, confirmed: nConf })),
        el('button', { class: 'primary', onclick: () => act(() => { state.ui.tab = 'rounds'; }) }, T('setup.goRounds'))));
    } else {
      wrap.append(section(T('setup.start'),
        errs.length ? el('ul', { class: 'errors' }, errs.map(e => el('li', {}, e))) : null,
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
  function confirmCurrent(idx) {
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
      return el('div', { class: 'card empty' }, T('rounds.empty'));
    }
    const idx = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[idx];
    const pm = playerMap();
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const name = id => (pm.get(id) || { name: '?' }).name;
    const label = r => T(r.status === 'confirmed' ? 'status.confirmed' : 'status.draft');

    const editIdx = S.editableIndex(state.rounds);
    const editable = idx === editIdx && round.status === 'draft';
    const isSel = id => selected != null && sameUnit(selected, id);
    const pname = (id, cls) => (editable
      ? el('button', { class: `pname ${cls || ''}${isSel(id) ? ' sel' : ''}`, onclick: () => pick(id) }, name(id))
      : el('span', { class: cls || '' }, name(id)));

    const bar = el('div', { class: 'round-bar' },
      el('button', { class: 'link back', onclick: () => act(() => { state.ui.tab = 'setup'; }) }, T('rounds.back')),
      el('button', { class: 'nav', disabled: idx === 0, title: T('rounds.prev'), 'aria-label': T('rounds.prevAria'), onclick: () => goRound(idx - 1) }, '‹'),
      el('div', { class: 'pills' }, state.rounds.map((r, i) => el('button', {
        class: `pill ${r.status}${i === idx ? ' active' : ''}`, title: T('rounds.pill', { n: i + 1, status: label(r) }),
        onclick: () => goRound(i),
      }, String(i + 1)))),
      el('button', { class: 'nav next', disabled: idx === state.rounds.length - 1, title: T('rounds.nextTitle'), onclick: () => goRound(idx + 1) }, T('rounds.next')),
      el('button', { class: 'fs-btn', onclick: toggleFullscreen }, T(document.fullscreenElement ? 'rounds.exitFullscreen' : 'rounds.fullscreen')));

    const title = el('h2', { class: 'round-title' }, T('rounds.title', { n: idx + 1, total: state.rounds.length }),
      el('span', { class: 'badge ' + round.status }, label(round)));

    // Scores only in confirmed rounds; names are clickable only in the current (editable) round.
    const team = (m, key, label) => {
      const ids = m[key === 'scoreA' ? 'teamA' : 'teamB'];
      return el('div', { class: 'team-row' },
        el('div', { class: 'tnames', title: ids.map(name).join(' / ') },
          ids.map((id, i) => [i ? ' / ' : null, pname(id)])),
        round.status === 'confirmed' ? scoreInput(m, key, label) : null);
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
    }
    const msg = notice && state.ui.tab === 'rounds' ? el('div', { class: 'notice ' + notice.kind }, notice.text) : null;

    const cards = el('div', { class: 'courts' + (round.status === 'draft' ? ' draft' : '') }, round.matches.map(m => {
      const g = gm.get(m.groupId) || { name: '', color: null };
      return el('div', { class: 'court', style: gStyle(g.color) },
        el('div', { class: 'court-head' }, T('rounds.court', { n: m.court, group: g.name })),
        team(m, 'scoreA', T('rounds.teamA')), el('div', { class: 'vs' }, T('rounds.vs')), team(m, 'scoreB', T('rounds.teamB')));
    }));

    const groupsResting = state.groups.map(g => ({
      g, ids: round.resting.filter(id => (pm.get(id) || {}).groupId === g.id).sort((a, b) => name(a).localeCompare(name(b))),
    })).filter(x => x.ids.length);
    const resting = el('div', { class: 'resting' }, el('h3', {}, T('rounds.resting')),
      groupsResting.length ? groupsResting.map(({ g, ids }) => el('div', { class: 'rest-group', style: gStyle(g.color) },
        el('span', { class: 'rest-label' }, g.name),
        ids.map(id => pname(id, 'chip')))) : el('p', { class: 'muted' }, T('rounds.nobodyRests')));

    return el('div', { class: 'rounds' }, bar, title, msg, tools, cards, resting);
  };

  const notStarted = () => el('div', { class: 'card empty' }, T('rounds.empty'));

  let findQuery = '';         // Find player search text (not persisted)

  // Assignment in the round selected on the Rounds tab.
  views.find = () => {
    if (!state.started || !state.rounds.length) return notStarted();
    const ci = Math.max(0, Math.min(state.ui.roundIdx, state.rounds.length - 1));
    const round = state.rounds[ci];
    const gm = new Map(state.groups.map(g => [g.id, g]));
    const where = new Map();
    round.matches.forEach(m => m.teamA.concat(m.teamB).forEach(id => where.set(id, T('court.n', { n: m.court }))));
    round.resting.forEach(id => where.set(id, null));
    const players = state.players.slice().sort((a, b) => a.name.localeCompare(b.name));
    const items = players.map(p => {
      const court = where.get(p.id);
      const w = court || T(where.has(p.id) ? 'find.resting' : 'find.absent');
      const item = el('div', { class: 'find-item', style: gStyle((gm.get(p.groupId) || {}).color) },
        el('span', { class: 'find-name' }, p.name),
        el('span', { class: 'find-where' + (court ? '' : ' off') }, w));
      return { item, key: p.name.toLowerCase() };
    });
    const empty = el('p', { class: 'muted' }, T('find.noMatch'));
    // Filter in place so the search box keeps focus while typing.
    const apply = () => {
      const q = norm(findQuery).toLowerCase();
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
    const head = ['rank', isTeams() ? 'team' : 'name', 'group', 'played', 'rested', 'won', 'lost', 'diff', 'wdl', 'avg']
      .map(k => T('rank.' + k));
    return el('section', { class: 'card rank-card', style: gStyle(color) },
      el('h2', {}, color ? el('span', { class: 'swatch' }) : null, title),
      el('table', { class: 'rank' },
        el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { class: i > 2 ? 'num' : '' }, h)))),
        el('tbody', {}, rows.map(r => el('tr', {},
          el('td', { class: 'num' }, String(r.rank)),
          el('td', { class: 'rname' }, r.name),
          el('td', {}, el('span', { class: 'swatch', style: gStyle((gm.get(r.groupId) || {}).color) }), r.group),
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
      el('div', { class: 'final-head' }, el('h1', {}, T('rank.final')),
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

  function render() {
    renderTabs();
    const view = document.getElementById('view');
    const fn = views[state.ui.tab];
    view.replaceChildren(fn ? fn() : el('p', {}, ''));
  }

  render();
})();
