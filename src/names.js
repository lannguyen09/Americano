/* Padel Americano — name parsing for Setup (pure, no DOM). */
(function (root) {
  'use strict';

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  // Duplicate key: case- and space-insensitive.
  const key = s => String(s == null ? '' : s).replace(/\s+/g, '').toLowerCase();

  // Name particles that stay lowercase when not the first word (van der Berg, de Vries).
  const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'du', 'het', 'te', 'ter', 'ten', "'t", 'la', 'le', 'vd']);
  // Capitalise words typed fully in lowercase; mixed case (McDonald, DJ) is left as typed.
  function capitalise(name) {
    return norm(name).split(' ').map((w, i) => {
      if (!w || w !== w.toLowerCase()) return w;
      if (i > 0 && PARTICLES.has(w)) return w;
      return w.replace(/(^|[-'])(\p{L})/gu, (m, sep, c) => sep + c.toUpperCase());
    }).join(' ');
  }

  // Teams line: separators / & + or Tab (spaces optional). Comma is NOT a separator.
  function splitTeam(line) {
    return String(line).split(/[\/&+\t]/).map(capitalise);
  }

  // "Jan" taken → "Jan (2)", "Jan (3)", ...
  function uniqueName(name, takenKeys) {
    const base = norm(name).replace(/\s*\(\d+\)$/, '');
    for (let n = 2; ; n++) {
      const cand = `${base} (${n})`;
      if (!takenKeys.has(key(cand))) return cand;
    }
  }

  // Players mode, one cell per line; Excel rows with a Tab: name<Tab>level.
  function splitPlayer(line) {
    const cells = String(line).split('\t').map(norm);
    return { names: [capitalise(cells[0])], level: cells[1] || null };
  }

  const isHeader = line => /^\s*name\s*([\t,;].*)?$/i.test(line);

  // Parse pasted text into rows.
  // opts: {teams: bool, taken: [existing names]}
  // row: {raw, line (display), names, level, ok, reason: null|'format'|'sameTwice'|'taken'|'dupInList', suggestion: [names]|null}
  // Duplicates within the paste are reported against earlier lines; suggestions are unique against everything.
  function parseLines(text, opts) {
    const teams = !!(opts && opts.teams);
    const taken = new Set(((opts && opts.taken) || []).map(key));
    const inList = new Set();
    const all = new Set(taken);
    const rows = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      if (!norm(raw) || isHeader(raw)) continue;
      const line = norm(raw.replace(/\t/g, teams ? ' / ' : ' '));
      const parsed = teams ? { names: splitTeam(raw), level: null } : splitPlayer(raw);
      const names = parsed.names;
      const row = { raw: raw.replace(/^\s+|\s+$/g, ''), line, names, level: parsed.level, ok: true, reason: null, suggestion: null };
      if (teams && (names.length !== 2 || !names[0] || !names[1])) {
        row.ok = false; row.reason = 'format';
      } else if (teams && key(names[0]) === key(names[1])) {
        row.ok = false; row.reason = 'sameTwice';
      } else {
        const dup = names.find(n => taken.has(key(n)) || inList.has(key(n)));
        if (dup) {
          row.ok = false;
          row.reason = taken.has(key(dup)) ? 'taken' : 'dupInList';
          row.dup = dup;
          const used = new Set(all);
          row.suggestion = names.map(n => {
            if (!taken.has(key(n)) && !inList.has(key(n))) return n;
            const s = uniqueName(n, used);
            used.add(key(s));
            return s;
          });
        }
      }
      if (row.ok) names.forEach(n => { inList.add(key(n)); all.add(key(n)); });
      rows.push(row);
    }
    return rows;
  }

  // CSV / Excel import: columns name[, level]. Delimiter: Tab, ';' or ','. Header row optional.
  // Returns text lines for parseLines (players: "name<Tab>level"; teams: "name1<Tab>name2" or the name cell).
  function importToText(text, teams) {
    const lines = String(text || '').split(/\r?\n/).filter(l => norm(l));
    if (!lines.length) return '';
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
    const unq = c => norm(c).replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
    const rows = lines.map(l => l.split(delim).map(unq));
    let nameCol = 0, levelCol = 1;
    const head = rows[0].map(c => c.toLowerCase());
    const hasHeader = head.includes('name');
    if (hasHeader) {
      nameCol = head.indexOf('name');
      levelCol = head.indexOf('level');
      rows.shift();
    }
    if (teams) return rows.map(r => (hasHeader ? r[nameCol] || '' : r.slice(0, 2).filter(Boolean).join('\t'))).join('\n');
    return rows.map(r => [r[nameCol] || '', levelCol >= 0 ? r[levelCol] || '' : ''].join('\t').replace(/\t$/, '')).join('\n');
  }

  // Short form when a name does not fit: last part as initial ("Jan de Vries" → "Jan de V."; "Jan (2)" stays).
  function shortName(name) {
    const w = norm(name).split(' ');
    const suffix = w.length > 1 && /^\(\d+\)$/.test(w[w.length - 1]) ? ' ' + w.pop() : '';
    if (w.length < 2) return w.join(' ') + suffix;
    const last = w.pop();
    return `${w.join(' ')} ${last.charAt(0)}.${suffix}`;
  }

  const api = { norm, key, capitalise, splitTeam, uniqueName, parseLines, importToText, shortName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Names = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
