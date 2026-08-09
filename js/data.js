// ============================================================
// DATA LAYER — player pool management
// Sources: (1) built-in curated board (players.js), (2) live ADP sync via
// the Cloudflare Worker proxy, (3) CSV import. All three funnel through
// rebuildPool() so the rest of the app never changes.
// ============================================================
const DataLayer = (function () {

  // ---- name matching so synced ADP lines up with curated projections ----
  function norm(name) {
    return name.toLowerCase()
      .replace(/[.'’,]/g, '')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const CURATED = new Map(PLAYER_DATA.map(d => [
    norm(d[0]), { proj: d[4], rec: d[5], bye: d[6] }
  ]));

  // ---- projection estimation when a source gives ADP but no points -------
  // Grading is ADP-driven, so estimates only need to be monotonic & sane.
  function estimateProj(pos, adp, rankInPos) {
    const base = { QB: 300, RB: 270, WR: 265, TE: 210, K: 150, DST: 135 }[pos] || 180;
    const floor = { QB: 210, RB: 55, WR: 60, TE: 70, K: 120, DST: 100 }[pos] || 60;
    const decay = { QB: 4.0, RB: 6.5, WR: 5.5, TE: 5.0, K: 1.8, DST: 2.2 }[pos] || 5;
    return Math.max(floor, Math.round(base - (rankInPos || 0) * decay));
  }
  function estimateRec(pos, proj) {
    const share = { WR: 0.36, TE: 0.34, RB: 0.16, QB: 0, K: 0, DST: 0 }[pos] || 0;
    return Math.round(proj * share);
  }

  // ---- rebuild the global PLAYERS array in place -------------------------
  // rows: [{name, pos, team, adp, bye?, proj?, rec?}]
  function rebuildPool(rows, sourceLabel) {
    const clean = rows
      .filter(r => r.name && r.pos && isFinite(r.adp))
      .map(r => ({ ...r, pos: normalizePos(r.pos) }))
      .filter(r => VALID_POS.has(r.pos))
      .sort((a, b) => a.adp - b.adp);

    if (clean.length < 20) throw new Error(`Only ${clean.length} valid players found — need at least 20.`);

    // rank within position for projection estimates
    const posRank = {};
    const built = clean.map((r, i) => {
      posRank[r.pos] = (posRank[r.pos] || 0);
      const rank = posRank[r.pos]++;
      const cur = CURATED.get(norm(r.name));
      const proj = isFinite(r.proj) ? +r.proj
        : (cur ? cur.proj : estimateProj(r.pos, r.adp, rank));
      const rec = isFinite(r.rec) ? +r.rec
        : (cur ? cur.rec : estimateRec(r.pos, proj));
      const bye = isFinite(r.bye) ? +r.bye : (cur ? cur.bye : 0);
      return {
        id: i, name: r.name, team: (r.team || '').toUpperCase(), pos: r.pos,
        adp: +r.adp, proj, rec, bye, drafted: false
      };
    });

    // mutate the const array the rest of the app holds a reference to
    PLAYERS.length = 0;
    built.forEach(p => PLAYERS.push(p));
    poolMeta = { label: sourceLabel, count: built.length, at: Date.now() };
    saveMeta();
    return poolMeta;
  }

  const VALID_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);
  function normalizePos(p) {
    p = String(p).toUpperCase().replace(/[^A-Z/]/g, '');
    if (p === 'PK') return 'K';
    if (p === 'DEF' || p === 'D/ST' || p === 'DST' || p === 'D') return 'DST';
    return p;
  }

  // ---- restore built-in board -------------------------------------------
  function useBuiltIn() {
    const rows = PLAYER_DATA.map(d => ({
      name: d[0], team: d[1], pos: d[2], adp: d[3], proj: d[4], rec: d[5], bye: d[6]
    }));
    return rebuildPool(rows, 'Built-in 2026 board');
  }

  // ---- live ADP sync via worker proxy -----------------------------------
  // format: 'standard' | 'half-ppr' | 'ppr'
  async function syncADP(format, teams, year) {
    if (!CONFIG.adpProxyUrl) {
      throw new Error('No ADP proxy configured. Deploy the Cloudflare Worker in /worker and set adpProxyUrl in js/config.js, or use CSV import.');
    }
    const url = `${CONFIG.adpProxyUrl.replace(/\/$/, '')}/?format=${format}&teams=${teams}&year=${year}`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`ADP feed returned ${resp.status}. Try CSV import instead.`);
    const data = await resp.json();
    const players = data.players || data;
    if (!Array.isArray(players) || !players.length) throw new Error('ADP feed was empty.');
    const rows = players.map(p => ({
      name: p.name, team: p.team, pos: p.position || p.pos,
      adp: p.adp, bye: p.bye
    }));
    const fmtLabel = { 'standard': 'Standard', 'half-ppr': 'Half PPR', 'ppr': 'Full PPR' }[format] || format;
    return rebuildPool(rows, `Live ADP · ${fmtLabel} · ${teams}-team`);
  }

  // ---- FantasyPros expert-consensus rankings ----------------------------
  // Board value = rank_ave (average rank across ~100 experts).
  // IMPORTANT (verified): the FP API returns 403 on CORS preflight, so a
  // browser can never call it directly with the x-api-key header. All
  // requests go through a proxy: CONFIG.fantasyPros.proxyUrl (Cloudflare
  // Worker /fp with FP_API_KEY secret), or same-origin /fp (local dev
  // server). A pasted key (localStorage) is forwarded for proxies that
  // don't hold their own key.
  const FP_SCORING = { 1: 'PPR', 0.5: 'HALF', 0: 'STD' };
  function fpKey() { return localStorage.getItem('gridiron-fp-key') || ''; }
  function setFpKey(k) { localStorage.setItem('gridiron-fp-key', (k || '').trim()); }

  async function syncFantasyPros(pprSetting, year) {
    const scoring = FP_SCORING[pprSetting] || 'HALF';
    const proxy = (CONFIG.fantasyPros && CONFIG.fantasyPros.proxyUrl) ||
      (location.protocol.startsWith('http') ? '/fp' : '');
    if (!proxy) {
      throw new Error('FantasyPros blocks direct browser requests — serve the app over http with the /fp proxy, or configure the worker (SELLING.md).');
    }
    const key = fpKey();
    const resp = await fetch(`${proxy.replace(/\/$/, '')}?scoring=${scoring}&year=${year}`,
      { headers: key ? { 'x-api-key': key } : {} });
    if (resp.status === 401 || resp.status === 403) {
      const err = new Error('FantasyPros rejected the API key. Double-check it and paste it again.');
      err.needsKey = true;
      throw err;
    }
    if (resp.status === 404 || resp.status === 501) {
      throw new Error('No FantasyPros proxy is set up on this deployment — see SELLING.md (worker /fp + FP_API_KEY).');
    }
    if (!resp.ok) throw new Error(`FantasyPros returned ${resp.status}. Try again or use CSV import.`);
    const data = await resp.json();
    if (!Array.isArray(data.players) || !data.players.length) throw new Error('FantasyPros feed was empty.');
    const rows = data.players.map(p => ({
      name: p.player_name,
      team: p.player_team_id,
      pos: p.player_position_id,
      adp: parseFloat(p.rank_ave) || p.rank_ecr,
      bye: parseInt(p.player_bye_week, 10)
    }));
    const experts = data.total_experts ? ` · ${data.total_experts} experts` : '';
    return rebuildPool(rows, `FantasyPros ECR · ${scoring}${experts}`);
  }

  // ---- CSV import --------------------------------------------------------
  function parseCSV(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n' || c === '\r') {
          if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
          if (c === '\r' && text[i + 1] === '\n') i++;
        } else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  const HEADER_ALIASES = {
    name: ['name', 'player', 'player name', 'playername'],
    pos: ['pos', 'position', 'pposition(s)'],
    team: ['team', 'tm', 'nfl team'],
    adp: ['adp', 'avg', 'average', 'overall', 'rank', 'ovr'],
    proj: ['proj', 'projection', 'projections', 'points', 'pts', 'fpts', 'projected'],
    rec: ['rec', 'receptions', 'targets'],
    bye: ['bye', 'bye week', 'byeweek']
  };
  function importCSV(text) {
    const grid = parseCSV(text);
    if (grid.length < 2) throw new Error('CSV has no data rows.');
    const header = grid[0].map(h => h.trim().toLowerCase());
    const col = {};
    for (const key of Object.keys(HEADER_ALIASES)) {
      col[key] = header.findIndex(h => HEADER_ALIASES[key].includes(h));
    }
    if (col.name < 0) throw new Error('CSV needs a "name" (or "player") column.');
    if (col.adp < 0 && col.proj < 0) throw new Error('CSV needs an "adp" or "proj" column to rank players.');

    const rows = grid.slice(1).map(r => {
      const get = k => (col[k] >= 0 ? (r[col[k]] || '').trim() : '');
      const num = k => { const v = parseFloat(get(k).replace(/[^0-9.\-]/g, '')); return isFinite(v) ? v : NaN; };
      let adp = num('adp');
      let name = get('name');
      // Split "Player, TEAM" or "Player (TEAM - POS)" is out of scope; keep simple.
      return {
        name, team: get('team'), pos: get('pos'),
        adp, proj: num('proj'), rec: num('rec'), bye: num('bye')
      };
    });
    // If no ADP column, derive ADP from projection rank (higher proj = earlier)
    if (col.adp < 0) {
      rows.filter(r => isFinite(r.proj)).sort((a, b) => b.proj - a.proj)
        .forEach((r, i) => r.adp = i + 1);
    }
    // Infer position from name for D/ST entries missing pos
    rows.forEach(r => { if (!r.pos && /d\/?st|defense/i.test(r.name)) r.pos = 'DST'; });
    return rebuildPool(rows, `CSV import (${rows.length} players)`);
  }

  // ---- meta persistence --------------------------------------------------
  let poolMeta = null;
  function saveMeta() { try { localStorage.setItem('gridiron-pool-meta', JSON.stringify(poolMeta)); } catch {} }
  function loadMeta() { try { return JSON.parse(localStorage.getItem('gridiron-pool-meta')); } catch { return null; } }

  return { rebuildPool, useBuiltIn, syncADP, syncFantasyPros, fpKey, setFpKey, importCSV, parseCSV, getMeta: () => poolMeta, loadMeta };
})();
