// ============================================================
// GRIDIRON COMMAND — draft engine, grading, and UI
// ============================================================

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

// ---------- State ----------
const DEFAULT_SETTINGS = {
  teams: 12, rounds: 15, ppr: 0.5, qb: 1,
  flex: 1,          // flex starters (RB/WR/TE) — 2 widens RB/WR replacement levels
  kicker: true,     // false = no K roster slot, kickers leave the pool
  passTd: 4,        // 4 or 6 points per passing TD
  volume: false,    // +0.1 per completion and per rush attempt
  preset: 'custom',
  announcer: true, cheer: true, names: []
};

// League presets: one click fills in every league setting for a known format.
const PRESETS = {
  megalabowl: {
    label: 'Megalabowl',
    settings: { teams: 12, rounds: 14, ppr: 0.5, qb: 1, flex: 2, kicker: false, passTd: 6, volume: true },
    note: 'Fantasy Footballers Megalabowl loaded: 12 teams · 14 rounds · half PPR · 1QB/2RB/2WR/1TE/2FLEX/DST, no kicker · 6-pt passing TD · +0.1 per completion and per carry.'
  }
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  picks: [],          // [{playerId, overall, team, round, slot, grade, score, delta}]
  started: false,
  posFilter: 'ALL'
};

const GRADE_STEPS = [
  [95, 'A+'], [88, 'A'], [80, 'A-'], [72, 'B+'], [64, 'B'], [56, 'B-'],
  [50, 'C+'], [42, 'C'], [36, 'C-'], [28, 'D+'], [20, 'D'], [0, 'F']
];
const POS_COLORS = { QB: '#e0526e', RB: '#3dd68c', WR: '#4aa8ff', TE: '#f5a83d', K: '#b18cf0', DST: '#8a939e' };

// ============================================================
// SCORING-FORMAT VALUE MODEL
// ============================================================

// Projection adjusted for league scoring. Data baseline is full PPR with
// 4-pt passing TDs and no volume bonuses; everything else is layered on.
function adjProj(p) {
  const s = state.settings;
  let pts = p.proj + (s.ppr - 1) * p.rec;
  if (p.pos === 'QB') {
    // 6-pt passing TDs: a QB scores roughly one pass TD per 11 baseline
    // points, and each one is worth +2 → about +18% of the projection.
    if (s.passTd === 6) pts += p.proj * 0.18;
    // +0.1 per completion (~60 + 0.85 per baseline point) plus ~50 carries
    if (s.volume) pts += 0.1 * (60 + 0.85 * p.proj) + 5;
  } else if (p.pos === 'RB' && s.volume) {
    // +0.1 per carry. Carries are estimated from the non-receiving share of
    // the projection (a catch ≈ 1.8 full-PPR pts, a carry ≈ 0.65 pts), so
    // workhorse backs gain ~30-35 pts and pass-catching backs ~10-15.
    const rushPts = Math.max(0, p.proj - 1.8 * p.rec);
    pts += 0.1 * (rushPts / 0.65);
  }
  return pts;
}

// Positions that exist in this league's lineup (kickers can be switched off)
function rosterable(p) { return state.settings.kicker || p.pos !== 'K'; }

// Replacement-level projection per position for this league size/format
function replacementLevels() {
  const T = state.settings.teams;
  const starters = {
    QB: Math.round(T * (state.settings.qb === 2 ? 2.2 : 1.3)),
    RB: Math.round(T * (state.settings.flex === 2 ? 2.9 : 2.6)),
    WR: Math.round(T * (state.settings.flex === 2 ? 3.1 : 2.8)),
    TE: Math.round(T * 1.3),
    K: T, DST: T
  };
  const levels = {};
  for (const pos of Object.keys(starters)) {
    const group = PLAYERS.filter(p => p.pos === pos)
      .map(adjProj).sort((a, b) => b - a);
    const idx = Math.min(starters[pos], group.length - 1);
    levels[pos] = group[idx] ?? 0;
  }
  return levels;
}

// Market ADP adjusted for format. Baseline ADP is full-PPR; for other
// formats, players re-slot within their position group by adjusted
// projection, and position groups tilt slightly (RBs up / pass-catchers
// down as reception points shrink).
let fmtAdpMap = null;
function computeFormatADP() {
  fmtAdpMap = new Map();
  const f = 1 - state.settings.ppr;   // 0 = full PPR … 1 = standard
  const posShift = { RB: 1 - 0.06 * f, WR: 1 + 0.05 * f, TE: 1 + 0.04 * f, QB: 1, K: 1, DST: 1 };
  for (const pos of Object.keys(posShift)) {
    const group = PLAYERS.filter(p => p.pos === pos);
    const slots = group.map(p => p.adp).sort((a, b) => a - b);
    const byProj = [...group].sort((a, b) => adjProj(b) - adjProj(a));
    byProj.forEach((p, i) => {
      let a = slots[i] * posShift[pos];
      if (pos === 'QB' && state.settings.qb === 2) a *= 0.45;  // superflex QB premium
      fmtAdpMap.set(p.id, Math.max(1, a));
    });
  }
}
function adjADP(p) { return fmtAdpMap.get(p.id); }

// Blended "true value" rank: market ADP + value-over-replacement rank
let valueCache = null;
function computeValueBoard() {
  computeFormatADP();
  const repl = replacementLevels();
  const withVor = PLAYERS.filter(rosterable).map(p => ({ p, vor: adjProj(p) - repl[p.pos], adp: adjADP(p) }));
  const byVor = [...withVor].sort((a, b) => b.vor - a.vor);
  byVor.forEach((e, i) => e.vorRank = i + 1);
  const byAdp = [...withVor].sort((a, b) => a.adp - b.adp);
  byAdp.forEach((e, i) => e.adpRank = i + 1);
  valueCache = new Map();
  for (const e of withVor) {
    valueCache.set(e.p.id, {
      trueValue: 0.55 * e.adpRank + 0.45 * e.vorRank,
      adpRank: e.adpRank, vorRank: e.vorRank, vor: e.vor
    });
  }
}

function trueValue(p) { return valueCache.get(p.id).trueValue; }

// ============================================================
// GRADING
// ============================================================
function rosterOf(teamIdx) {
  return state.picks.filter(pk => pk.team === teamIdx).map(pk => PLAYERS[pk.playerId]);
}

function gradePick(p, overall, teamIdx, round) {
  const adp = adjADP(p);
  // Tolerance widens as the draft goes on (late reaches matter less)
  const tol = 3 + overall * 0.18;
  let delta = overall - adp;                      // + = player fell to you, - = reach
  // How many clearly-better players (by board position) were passed up?
  const passedUp = PLAYERS.filter(x => !x.drafted && rosterable(x) && x.id !== p.id && adjADP(x) < adp - tol).length;
  if (passedUp === 0) delta = Math.max(delta, 0); // taking the top of the board is never a reach
  let score = 50;                                 // 50 = fair value
  score += Math.max(-28, Math.min(45, (delta / tol) * 18));
  score -= Math.min(20, passedUp * 1.5);
  if (passedUp === 0) score += 22;                // best player available — textbook
  else score += Math.max(0, 8 - passedUp * 2);

  // Roster construction adjustments
  const roster = rosterOf(teamIdx);
  const count = pos => roster.filter(r => r.pos === pos).length;
  let filledNeed = false;

  if (p.pos === 'K' && round <= 11) score -= 30;
  if (p.pos === 'DST' && round <= 9) score -= 25;
  const qbCount = count('QB') + 1;
  const qbCap = state.settings.qb === 2 ? 3 : 2;
  if (p.pos === 'QB' && qbCount > qbCap) score -= 18;
  if ((p.pos === 'RB' || p.pos === 'WR') && count(p.pos) === 0 && round >= 4) {
    score += 6; filledNeed = true;
  }
  if (p.pos === 'TE' && count('TE') === 0 && round >= 6) { score += 4; filledNeed = true; }

  score = Math.max(2, Math.min(99, score));
  const grade = GRADE_STEPS.find(([min]) => score >= min)[1];
  return { grade, score: Math.round(score), delta, filledNeed, qbCount };
}

// ============================================================
// DRAFT MECHANICS (snake)
// ============================================================
function slotForOverall(overall) {
  const T = state.settings.teams;
  const round = Math.floor((overall - 1) / T) + 1;
  const idxInRound = (overall - 1) % T;
  const team = round % 2 === 1 ? idxInRound : T - 1 - idxInRound;
  return { round, team };
}
function currentOverall() { return state.picks.length + 1; }
function totalPicks() { return state.settings.teams * state.settings.rounds; }
function pickLabel(overall) {
  const { round, team } = slotForOverall(overall);
  const idx = (overall - 1) % state.settings.teams + 1;
  return `${round}.${String(idx).padStart(2, '0')}`;
}
function teamName(i) { return state.settings.names[i] || `Team ${i + 1}`; }

// ============================================================
// RENDERING
// ============================================================
function renderBoard() {
  const board = $('#board');
  const T = state.settings.teams, R = state.settings.rounds;
  board.style.gridTemplateColumns = `52px repeat(${T}, minmax(72px, 1fr))`;
  board.innerHTML = '';

  // Header row
  board.appendChild(el('div', 'bh corner', ''));
  for (let t = 0; t < T; t++) {
    const h = el('div', 'bh', teamName(t));
    h.title = teamName(t);
    board.appendChild(h);
  }

  const cur = currentOverall();
  for (let r = 1; r <= R; r++) {
    const rh = el('div', 'brh', `R${r}`);
    board.appendChild(rh);
    for (let t = 0; t < T; t++) {
      const cell = el('div', 'cell');
      // which overall pick lands here?
      const idxInRound = r % 2 === 1 ? t : T - 1 - t;
      const overall = (r - 1) * T + idxInRound + 1;
      cell.dataset.overall = overall;
      const pk = state.picks[overall - 1];
      if (pk) {
        const p = PLAYERS[pk.playerId];
        cell.classList.add('filled', 'pos-' + p.pos);
        if (overall === state.picks.length) cell.classList.add('latest'); // freshest pick gets the flash
        cell.innerHTML =
          `<div class="c-pos" style="background:${POS_COLORS[p.pos]}">${p.pos}</div>
           <div class="c-name">${shortName(p.name)}</div>
           <div class="c-sub">${p.team} · <b class="g-${pk.grade.replace('+','p').replace('-','m')}">${pk.grade}</b></div>`;
        cell.style.setProperty('--pos-c', POS_COLORS[p.pos]);
      } else if (overall === cur && cur <= totalPicks()) {
        cell.classList.add('onclock');
        cell.innerHTML = `<div class="c-otc">⏱<br>ON THE<br>CLOCK</div>`;
      } else {
        cell.innerHTML = `<div class="c-num">${pickLabel(overall)}</div>`;
      }
      board.appendChild(cell);
    }
  }
  sizeHeaderFont();
}

// Size the team-name headers to the ACTUAL column width so names wrap cleanly
// (a word per line) instead of breaking mid-word. Viewport-based sizing can't
// know how narrow a 12/14/16-team column is; the real column width can.
function sizeHeaderFont() {
  const board = $('#board');
  const T = state.settings.teams;
  const inner = board.clientWidth - 16;               // minus board padding
  const gaps = (T + 1) * 3;                            // grid gaps
  const colW = Math.max(72, (inner - 52 - gaps) / T);  // 52px = round-header column
  // ~0.55·fontSize per bold char; fit an ~8-char word in (colW - side padding)
  const fit = (colW - 6) / (8 * 0.55);
  const fs = Math.max(13, Math.min(24, fit));
  board.style.setProperty('--bh-font', fs.toFixed(1) + 'px');
}

function shortName(n) {
  const parts = n.split(' ');
  if (n.length <= 14 || parts.length === 1) return n;
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

function renderClock() {
  const cur = currentOverall();
  const el = $('#clock-team');
  let nextName, nextPick;
  if (cur > totalPicks()) {
    nextName = 'DRAFT COMPLETE'; nextPick = '🏆';
  } else {
    const { team } = slotForOverall(cur);
    nextName = teamName(team);
    nextPick = `PICK ${pickLabel(cur)} · OVERALL #${cur}`;
  }
  // broadcast swap animation when the name on the clock changes
  if (el.textContent !== nextName) {
    el.classList.remove('swap');
    void el.offsetWidth;               // restart the animation
    el.classList.add('swap');
  }
  el.textContent = nextName;
  $('#clock-pick').textContent = nextPick;
}

function availablePlayers() {
  return PLAYERS.filter(p => !p.drafted && rosterable(p));
}

function renderPlayerList() {
  const q = $('#player-search').value.trim().toLowerCase();
  const list = $('#player-list');
  let pool = availablePlayers();
  if (state.posFilter !== 'ALL') pool = pool.filter(p => p.pos === state.posFilter);
  if (q) pool = pool.filter(p => p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q);
  pool.sort((a, b) => trueValue(a) - trueValue(b));
  list.innerHTML = '';
  for (const p of pool.slice(0, 40)) {
    const row = el('div', 'p-row');
    row.innerHTML =
      `<span class="p-pos" style="background:${POS_COLORS[p.pos]}">${p.pos}</span>
       <span class="p-name">${p.name}</span>
       <span class="p-info">${p.team} · BYE ${p.bye} · ADP ${Math.round(adjADP(p))}</span>
       <button class="p-draft">DRAFT</button>`;
    row.querySelector('.p-draft').addEventListener('click', () => makePick(p.id));
    list.appendChild(row);
  }
  if (!pool.length) list.innerHTML = '<div class="p-empty">No players match.</div>';
}

function renderBest() {
  const best = availablePlayers().sort((a, b) => trueValue(a) - trueValue(b)).slice(0, 6);
  const cur = currentOverall();
  $('#best-list').innerHTML = best.map((p, i) => {
    const val = Math.round(cur - adjADP(p));
    const tag = val > 5 ? `<span class="val-tag steal">+${val} VALUE</span>` :
                val < -5 ? `<span class="val-tag">early</span>` : `<span class="val-tag fair">fair</span>`;
    return `<div class="b-row">
      <span class="b-rank">${i + 1}</span>
      <span class="p-pos" style="background:${POS_COLORS[p.pos]}">${p.pos}</span>
      <span class="b-name">${p.name}</span>${tag}
    </div>`;
  }).join('');
}

function renderLeagueBadge() {
  const s = state.settings;
  const fmt = s.ppr === 1 ? 'FULL PPR' : s.ppr === 0.5 ? 'HALF PPR' : 'STANDARD';
  const preset = s.preset !== 'custom' && PRESETS[s.preset] ? ` · ${PRESETS[s.preset].label.toUpperCase()}` : '';
  $('#league-badge').textContent = `${s.teams} TEAM · ${fmt}${s.qb === 2 ? ' · SFLEX' : ''}${preset}`;
}

// Plain-language league summary for the announcer's context
function leagueDescription() {
  const s = state.settings;
  const bits = [`${s.teams}-team ${s.ppr === 1 ? 'PPR' : s.ppr === 0.5 ? 'half-PPR' : 'standard'}${s.qb === 2 ? ' superflex' : ''}`];
  if (s.preset !== 'custom' && PRESETS[s.preset]) bits.push(PRESETS[s.preset].label);
  if (s.passTd === 6) bits.push('6-pt passing TDs');
  if (s.volume) bits.push('+0.1 per completion and carry');
  if (s.flex === 2) bits.push('2 flex spots');
  if (!s.kicker) bits.push('no kicker');
  return bits.join(', ');
}

function renderAll() {
  renderBoard(); renderClock(); renderPlayerList(); renderBest();
  // auto-scroll board so the on-clock cell is visible
  const oc = $('.cell.onclock');
  if (oc) oc.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
}

// ============================================================
// PICK FLOW
// ============================================================
let revealTimer = null;

function makePick(playerId) {
  const overall = currentOverall();
  if (overall > totalPicks()) return;
  const p = PLAYERS[playerId];
  if (p.drafted) return;

  const { round, team } = slotForOverall(overall);
  const g = gradePick(p, overall, team, round);

  p.drafted = true;
  state.picks.push({ playerId, overall, team, round, grade: g.grade, score: g.score, delta: g.delta });
  save();

  // LLM announcer context — prefetch now so the line is ready by card-flip
  const llmCtx = buildAnnounceContext(p, overall, team, round, g);
  const prefetched = Announcer.prefetch(llmCtx);

  $('#player-search').value = '';
  renderAll();
  showGradeReveal(p, overall, team, round, g, llmCtx, prefetched);

  if (currentOverall() > totalPicks()) finishDraft();
}

function finishDraft() {
  $('#btn-recap').classList.remove('hidden');
  // prefetch a personalized wrap-up while the final grade card breathes
  const data = Recap.build();
  const wrapCtx = {
    mode: 'wrap',
    winner: data.byGrade[0] && { team: data.byGrade[0].name, grade: data.byGrade[0].grade },
    stealOfDraft: data.steal && data.steal.pk.delta > 2 ? {
      player: PLAYERS[data.steal.pk.playerId].name, team: teamName(data.steal.pk.team),
      pick: pickLabel(data.steal.pk.overall), value: Math.round(data.steal.pk.delta)
    } : null,
    biggestReach: data.reach && data.reach.pk.delta < -3 ? {
      player: PLAYERS[data.reach.pk.playerId].name, team: teamName(data.reach.pk.team),
      pick: pickLabel(data.reach.pk.overall), reach: Math.round(data.reach.pk.delta)
    } : null,
    league: `${leagueDescription()}, ${state.settings.rounds} rounds`
  };
  const prefetched = Announcer.prefetch(wrapCtx);
  setTimeout(() => {
    $('#grade-overlay').classList.add('hidden');
    Announcer.wrapSmart(wrapCtx, prefetched);
    Cheer.show('var(--gold)', 6500);   // full-length routine for the finale
    setTimeout(() => Recap.show(), 2600);
  }, 3400);
}

// Everything the LLM announcer might riff on, in one compact object
function buildAnnounceContext(p, overall, team, round, g) {
  const roster = rosterOf(team);
  const counts = {};
  roster.forEach(r => counts[r.pos] = (counts[r.pos] || 0) + 1);
  const recent = state.picks.slice(-4, -1).map(pk => {
    const rp = PLAYERS[pk.playerId];
    return `${rp.name} (${rp.pos}) to ${teamName(pk.team)} at ${pickLabel(pk.overall)}, grade ${pk.grade}`;
  });
  return {
    mode: 'pick',
    player: p.name, pos: p.pos, nflTeam: p.team,
    fantasyTeam: teamName(team),
    pick: pickLabel(overall), overall, round,
    grade: g.grade, score: g.score,
    valueDelta: Math.round(g.delta),      // + = fell to them, - = reach
    rosterAfterPick: counts,
    qbCountAfterPick: g.qbCount,
    filledPositionalNeed: g.filledNeed,
    recentPicks: recent,
    league: leagueDescription()
  };
}

function showGradeReveal(p, overall, team, round, g, llmCtx, prefetched) {
  const ov = $('#grade-overlay');
  const card = $('#grade-card');
  clearTimeout(revealTimer);
  ov.classList.remove('hidden');
  card.classList.remove('flipped');

  const gradeClass = g.score >= 72 ? 'good' : g.score >= 50 ? 'ok' : g.score >= 32 ? 'meh' : 'bad';
  $('#gc-grade').textContent = g.grade;
  $('#gc-grade').className = gradeClass;
  $('#gc-player').textContent = p.name;
  $('#gc-meta').textContent = `${p.pos} · ${p.team} · Pick ${pickLabel(overall)} (#${overall})`;
  const verdicts = { good: g.score >= 88 ? 'STEAL OF THE DRAFT' : 'GREAT VALUE', ok: 'SOLID PICK', meh: 'A REACH', bad: 'WAR ROOM MELTDOWN' };
  $('#gc-verdict').textContent = verdicts[gradeClass];
  $('#gc-verdict').className = gradeClass;
  const d = Math.round(g.delta);
  $('#gc-detail').textContent = `Board value: pick ${Math.round(adjADP(p))} · Taken: #${overall} (${d >= 0 ? '+' + d + ' value' : d + ' reach'})`;

  // flip after a beat of suspense
  setTimeout(() => {
    card.classList.add('flipped');
    if (g.score >= 80) FX.celebrate(POS_COLORS[p.pos]);
    if (g.score >= 88) Cheer.show(POS_COLORS[p.pos]);   // squad runs out for true steals
    if (g.score < 28) FX.boo();
    // template-context fields ride along for the fallback line builder
    Announcer.callSmart({
      ...llmCtx,
      player: p.name, team: teamName(team), pickLabel: pickLabel(overall),
      delta: g.delta, round, pos: p.pos, score: g.score,
      filledNeed: g.filledNeed, qbCount: g.qbCount
    }, prefetched);
  }, 900);

  revealTimer = setTimeout(() => ov.classList.add('hidden'), 6500);
  ov.onclick = () => { ov.classList.add('hidden'); clearTimeout(revealTimer); };
}

function undoPick() {
  const pk = state.picks.pop();
  if (!pk) return;
  PLAYERS[pk.playerId].drafted = false;
  Announcer.stop();
  Cheer.hide();
  $('#grade-overlay').classList.add('hidden');
  $('#announcer').classList.add('hidden');
  save();
  renderAll();
}

// ============================================================
// PERSISTENCE
// ============================================================
function save() {
  localStorage.setItem('gridiron-draft', JSON.stringify({
    settings: state.settings,
    picks: state.picks.map(pk => ({ ...pk })),
    // snapshot the active pool so resume maps playerIds correctly even if
    // the board came from live sync or CSV import
    pool: PLAYERS.map(p => ({ id: p.id, name: p.name, team: p.team, pos: p.pos, adp: p.adp, proj: p.proj, rec: p.rec, bye: p.bye })),
    poolLabel: (DataLayer.getMeta() && DataLayer.getMeta().label) || 'Built-in 2026 board'
  }));
}
function loadSaved() {
  try { return JSON.parse(localStorage.getItem('gridiron-draft')); }
  catch { return null; }
}

// ============================================================
// SETUP SCREEN WIRING
// ============================================================
function wireOptionGroup(id, onPick) {
  const grp = document.getElementById(id);
  grp.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    grp.querySelectorAll('button').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    onPick(btn.dataset.val);
  });
}

// ---- presets ----
function selectOption(id, val) {
  document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('sel', b.dataset.val === String(val)));
}
function syncSetupButtons() {
  const s = state.settings;
  selectOption('opt-preset', s.preset);
  selectOption('opt-teams', s.teams);
  selectOption('opt-rounds', s.rounds);
  selectOption('opt-scoring', s.ppr);
  selectOption('opt-qb', s.qb);
  selectOption('opt-flex', s.flex);
  selectOption('opt-kicker', s.kicker ? 'on' : 'off');
  selectOption('opt-passtd', s.passTd);
  selectOption('opt-volume', s.volume ? 'on' : 'off');
}
function applyPreset(name) {
  const note = $('#preset-note');
  if (name === 'custom' || !PRESETS[name]) {
    state.settings.preset = 'custom';
    note.textContent = 'Pick any settings below, or load a preset to fill them all in.';
    note.className = 'data-status';
  } else {
    Object.assign(state.settings, PRESETS[name].settings, { preset: name });
    note.textContent = PRESETS[name].note;
    note.className = 'data-status ok';
    renderTeamNameInputs();
  }
  syncSetupButtons();
}
// Any hand-edited league setting turns a loaded preset back into CUSTOM
function markCustom() {
  if (state.settings.preset !== 'custom') applyPreset('custom');
}

function renderTeamNameInputs() {
  const wrap = $('#team-name-inputs');
  wrap.innerHTML = '';
  for (let i = 0; i < state.settings.teams; i++) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = `Team ${i + 1}`;
    inp.value = state.settings.names[i] || '';
    inp.maxLength = 14;
    inp.addEventListener('input', () => { state.settings.names[i] = inp.value; });
    wrap.appendChild(inp);
  }
}

function startDraft(fresh) {
  if (fresh) {
    state.picks = [];
    PLAYERS.forEach(p => p.drafted = false);
  }
  computeValueBoard();
  Announcer.setEnabled(state.settings.announcer);
  renderLeagueBadge();
  // hide the K filter when the league has no kicker slot
  const kBtn = $('#pos-filters [data-pos="K"]');
  kBtn.classList.toggle('hidden', !state.settings.kicker);
  if (!state.settings.kicker && state.posFilter === 'K') {
    state.posFilter = 'ALL';
    $$('#pos-filters button').forEach(b => b.classList.toggle('sel', b.dataset.pos === 'ALL'));
  }
  $('#setup-screen').classList.remove('active');
  $('#draft-screen').classList.add('active');
  state.started = true;
  // reveal the recap button if this draft is already complete (resumed)
  $('#btn-recap').classList.toggle('hidden', state.picks.length < totalPicks());
  save();
  renderAll();
}

// Return to a draft that's still live in memory — no reload needed, just
// swap back to the board. This is the escape hatch from the SETUP screen.
function returnToDraftInProgress() {
  Announcer.setEnabled(state.settings.announcer);
  $('#setup-screen').classList.remove('active');
  $('#draft-screen').classList.add('active');
  $('#btn-recap').classList.toggle('hidden', state.picks.length < totalPicks());
  renderAll();
}

function resumeSavedDraft(saved) {
  state.settings = { ...DEFAULT_SETTINGS, ...saved.settings };   // older saves lack the newer keys
  syncSetupButtons();
  // restore the exact pool this draft was made against (preserves ids)
  if (saved.pool && saved.pool.length) {
    PLAYERS.length = 0;
    saved.pool.forEach(p => PLAYERS.push({ ...p, drafted: false }));
  }
  state.picks = saved.picks;
  state.picks.forEach(pk => { if (PLAYERS[pk.playerId]) PLAYERS[pk.playerId].drafted = true; });
  startDraft(false);
}

// Decide what the button under KICKOFF offers: jump back into a live
// in-memory draft, resume one saved from a previous session, or nothing.
function updateResumeButton() {
  const btn = $('#btn-resume');
  if (state.started && state.picks.length > 0) {
    btn.classList.remove('hidden');
    btn.textContent = '◀ BACK TO CURRENT DRAFT';
    btn.onclick = returnToDraftInProgress;
    return;
  }
  const saved = loadSaved();
  if (saved && saved.picks && saved.picks.length) {
    btn.classList.remove('hidden');
    btn.textContent = 'RESUME SAVED DRAFT';
    btn.onclick = () => resumeSavedDraft(saved);
  } else {
    btn.classList.add('hidden');
  }
}

function init() {
  // league settings: editing any of them by hand drops back to the CUSTOM preset
  const league = (id, fn) => wireOptionGroup(id, v => { fn(v); markCustom(); });
  league('opt-teams', v => { state.settings.teams = +v; renderTeamNameInputs(); });
  league('opt-rounds', v => state.settings.rounds = +v);
  league('opt-scoring', v => state.settings.ppr = +v);
  league('opt-qb', v => state.settings.qb = +v);
  league('opt-flex', v => state.settings.flex = +v);
  league('opt-kicker', v => state.settings.kicker = v === 'on');
  league('opt-passtd', v => state.settings.passTd = +v);
  league('opt-volume', v => state.settings.volume = v === 'on');
  wireOptionGroup('opt-preset', applyPreset);
  wireOptionGroup('opt-announcer', v => state.settings.announcer = v === 'on');
  wireOptionGroup('opt-cheer', v => state.settings.cheer = v === 'on');
  renderTeamNameInputs();

  $('#btn-start').addEventListener('click', () => {
    // don't silently wipe a draft that's already underway
    if (state.started && state.picks.length > 0) {
      const done = state.picks.length >= totalPicks();
      const msg = done
        ? 'Start a NEW draft? Your finished draft and its recap will be replaced.'
        : 'A draft is in progress. Start a NEW draft and discard the current one?';
      if (!confirm(msg)) return;
    }
    startDraft(true);
  });
  wireDataSource();
  wireLicense();

  // Resume / return-to-draft button (its role is decided each time setup shows)
  updateResumeButton();

  $('#btn-undo').addEventListener('click', undoPick);
  $('#btn-recap').addEventListener('click', () => Recap.show());
  $('#btn-restart').addEventListener('click', () => {
    Announcer.stop();
    $('#draft-screen').classList.remove('active');
    $('#setup-screen').classList.add('active');
    updateResumeButton();   // ensure a way back into the live draft
  });

  $('#player-search').addEventListener('input', renderPlayerList);
  $('#pos-filters').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    $$('#pos-filters button').forEach(b => b.classList.remove('sel'));
    btn.classList.add('sel');
    state.posFilter = btn.dataset.pos;
    renderPlayerList();
  });

  // Keyboard: Enter drafts top search result
  $('#player-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = $('#player-list .p-draft');
      if (first) first.click();
    }
  });

  applyLicenseGate();
}

// ============================================================
// DATA SOURCE
// ============================================================
function currentFormat() {
  return state.settings.ppr === 1 ? 'ppr' : state.settings.ppr === 0.5 ? 'half-ppr' : 'standard';
}
function setDataStatus(txt, cls) {
  const e = $('#data-status'); e.textContent = txt; e.className = 'data-status ' + (cls || '');
}
function markDataBtn(btn) { $$('#opt-data button').forEach(b => b.classList.remove('sel')); btn.classList.add('sel'); }

function wireDataSource() {
  // hint if live sync isn't configured (seller hasn't deployed the proxy)
  if (!CONFIG.adpProxyUrl) {
    const live = $('#data-live-btn');
    if (live) live.querySelector('small').textContent = 'requires the ADP proxy — see SELLING.md';
  }
  $('#opt-data').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    selectDataSource(btn.dataset.src, btn);
  });
  $('#fp-key-save').addEventListener('click', () => {
    const k = $('#fp-key-input').value.trim();
    if (!k) { setDataStatus('⚠ Paste your FantasyPros API key first.', 'err'); return; }
    DataLayer.setFpKey(k);
    $('#fp-key-input').value = '';
    syncFantasyProsFlow();
  });
  $('#fp-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') $('#fp-key-save').click(); });

  $('#csv-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const meta = DataLayer.importCSV(rd.result);
        markDataBtn($('#opt-data [data-src="csv"]'));
        setDataStatus(`✓ ${meta.label}`, 'ok');
      } catch (err) { setDataStatus('⚠ ' + err.message, 'err'); }
    };
    rd.readAsText(file);
    e.target.value = '';
  });
}

async function selectDataSource(src, btn) {
  if (src === 'builtin') {
    DataLayer.useBuiltIn();
    markDataBtn(btn);
    setDataStatus('Using built-in 2026 board.');
    $('#fp-key-row').classList.add('hidden');
  } else if (src === 'fp') {
    markDataBtn(btn);
    await syncFantasyProsFlow();
  } else if (src === 'live') {
    markDataBtn(btn);
    setDataStatus('Syncing live ADP…', 'loading');
    try {
      const meta = await DataLayer.syncADP(currentFormat(), state.settings.teams, CONFIG.dataYear);
      setDataStatus(`✓ ${meta.label} · ${meta.count} players`, 'ok');
    } catch (e) {
      setDataStatus('⚠ ' + e.message, 'err');
      DataLayer.useBuiltIn();
      markDataBtn($('#opt-data [data-src="builtin"]'));
    }
  } else if (src === 'csv') {
    $('#csv-file').click();   // selection confirmed when a file loads
  }
}

async function syncFantasyProsFlow() {
  setDataStatus('Syncing FantasyPros consensus rankings…', 'loading');
  try {
    const meta = await DataLayer.syncFantasyPros(state.settings.ppr, CONFIG.dataYear);
    $('#fp-key-row').classList.add('hidden');
    setDataStatus(`✓ ${meta.label} · ${meta.count} players`, 'ok');
  } catch (e) {
    if (e.needsKey) {
      // reveal the key input instead of failing
      $('#fp-key-row').classList.remove('hidden');
      $('#fp-key-input').focus();
      setDataStatus('⚠ ' + e.message, 'err');
    } else {
      setDataStatus('⚠ ' + e.message, 'err');
      DataLayer.useBuiltIn();
      markDataBtn($('#opt-data [data-src="builtin"]'));
    }
  }
}

// ============================================================
// LICENSE
// ============================================================
function wireLicense() {
  $('#lic-buy').href = License.buyUrl || '#';
  $('#btn-activate').addEventListener('click', activateFlow);
  $('#lic-key').addEventListener('keydown', e => { if (e.key === 'Enter') activateFlow(); });
}

async function activateFlow() {
  const btn = $('#btn-activate'), msg = $('#lic-msg');
  const key = $('#lic-key').value;
  btn.disabled = true; btn.textContent = 'ACTIVATING…'; msg.textContent = '';
  const res = await License.activate(key);
  btn.disabled = false; btn.textContent = '🔓  ACTIVATE';
  msg.textContent = res.message;
  msg.className = 'lic-msg ' + (res.ok ? 'ok' : 'err');
  if (res.ok) setTimeout(() => {
    $('#license-screen').classList.remove('active');
    $('#setup-screen').classList.add('active');
  }, 900);
}

function applyLicenseGate() {
  if (License.isUnlocked()) {
    // background re-check; if the key was revoked, lock on next load
    if (License.needsRevalidate()) {
      License.revalidate().then(ok => {
        if (!ok && CONFIG.license.requireLicense) {
          $('#setup-screen').classList.remove('active');
          $('#draft-screen').classList.remove('active');
          $('#license-screen').classList.add('active');
        }
      });
    }
    return;
  }
  $('#setup-screen').classList.remove('active');
  $('#license-screen').classList.add('active');
}

document.addEventListener('DOMContentLoaded', init);
