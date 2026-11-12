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
      version: 1, mode: 'americano', seed: 1, numRounds: 6, started: false,
      groups: [], players: [], teams: [], courts: [], courtAssignment: {}, rounds: [],
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
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  }

  function renderTabs() {
    const nav = document.getElementById('tabs');
    nav.replaceChildren(...TABS.map(([id, label]) => el('button', {
      class: state.ui.tab === id ? 'active' : '',
      onclick: () => { state.ui.tab = id; save(); render(); },
    }, label)));
  }

  const views = {};

  function render() {
    renderTabs();
    const view = document.getElementById('view');
    const fn = views[state.ui.tab];
    view.replaceChildren(fn ? fn() : el('p', {}, ''));
  }

  render();
})();
