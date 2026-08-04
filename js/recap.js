// ============================================================
// POST-DRAFT RECAP — team grades, awards, and a shareable graphic
// Reads globals from app.js: state, PLAYERS, teamName, adjADP,
// adjProj, GRADE_STEPS, POS_COLORS, pickLabel.
// ============================================================
const Recap = (function () {

  function scoreToGrade(s) { return GRADE_STEPS.find(([min]) => s >= min)[1]; }

  function build() {
    const T = state.settings.teams;
    const teams = [];
    for (let i = 0; i < T; i++) {
      const picks = state.picks.filter(pk => pk.team === i);
      const players = picks.map(pk => PLAYERS[pk.playerId]);
      const avg = picks.length ? picks.reduce((s, pk) => s + pk.score, 0) / picks.length : 0;
      const projPts = players.reduce((s, p) => s + adjProj(p), 0);
      const posCount = {};
      players.forEach(p => posCount[p.pos] = (posCount[p.pos] || 0) + 1);
      // best & worst pick by value delta
      let best = null, worst = null;
      picks.forEach(pk => {
        if (!best || pk.delta > best.delta) best = pk;
        if (!worst || pk.delta < worst.delta) worst = pk;
      });
      teams.push({
        idx: i, name: teamName(i), picks, players,
        avg, grade: scoreToGrade(avg), projPts: Math.round(projPts), posCount, best, worst
      });
    }

    // rankings
    const byGrade = [...teams].sort((a, b) => b.avg - a.avg);
    const byPts = [...teams].sort((a, b) => b.projPts - a.projPts);

    // league-wide awards
    const all = state.picks.map(pk => ({ pk, p: PLAYERS[pk.playerId] }));
    const steal = all.reduce((m, x) => (!m || x.pk.delta > m.pk.delta) ? x : m, null);
    const reach = all.reduce((m, x) => (!m || x.pk.delta < m.pk.delta) ? x : m, null);

    return { teams, byGrade, byPts, steal, reach };
  }

  // ---------- on-screen recap ----------
  function show() {
    const data = build();
    const s = state.settings;
    const fmt = s.ppr === 1 ? 'Full PPR' : s.ppr === 0.5 ? 'Half PPR' : 'Standard';
    const ov = document.getElementById('recap-overlay');
    const body = document.getElementById('recap-body');

    const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const rows = data.byGrade.map((t, i) => `
      <div class="rc-team ${i === 0 ? 'rc-win' : ''}">
        <div class="rc-rank">${medal(i)}</div>
        <div class="rc-tname">${escapeHtml(t.name)}</div>
        <div class="rc-bar"><span style="width:${Math.max(4, t.avg)}%"></span></div>
        <div class="rc-grade g-${t.grade.replace('+','p').replace('-','m')}">${t.grade}</div>
        <div class="rc-pts">${t.projPts}<small>pts</small></div>
      </div>`).join('');

    const stealP = data.steal && data.steal.pk.delta > 2 ? PLAYERS[data.steal.pk.playerId] : null;
    const realReach = data.reach && data.reach.pk.delta < -3;
    const reachP = realReach ? PLAYERS[data.reach.pk.playerId] : null;

    body.innerHTML = `
      <div class="rc-head">
        <div class="rc-title">DRAFT COMPLETE</div>
        <div class="rc-sub">${s.teams}-Team · ${fmt}${s.qb === 2 ? ' · Superflex' : ''} · ${s.rounds} Rounds</div>
      </div>
      <div class="rc-awards">
        <div class="rc-award steal">
          <div class="rc-alabel">💎 STEAL OF THE DRAFT</div>
          <div class="rc-aname">${stealP ? escapeHtml(stealP.name) : 'No standout steals'}</div>
          <div class="rc-adet">${stealP ? `${teamName(data.steal.pk.team)} · ${pickLabel(data.steal.pk.overall)} · +${Math.round(data.steal.pk.delta)} value` : 'Everyone drafted close to value'}</div>
        </div>
        <div class="rc-award reach">
          <div class="rc-alabel">🧯 BIGGEST REACH</div>
          <div class="rc-aname">${reachP ? escapeHtml(reachP.name) : 'Clean draft!'}</div>
          <div class="rc-adet">${reachP ? `${teamName(data.reach.pk.team)} · ${pickLabel(data.reach.pk.overall)} · ${Math.round(data.reach.pk.delta)} reach` : 'No egregious reaches'}</div>
        </div>
      </div>
      <div class="rc-standings">
        <div class="rc-sh">POWER RANKINGS <small>by draft grade</small></div>
        ${rows}
      </div>
      <div class="rc-actions">
        <button id="rc-share" class="btn-kickoff rc-btn">📸 &nbsp;SHARE RESULTS</button>
        <button id="rc-close" class="btn-resume">BACK TO BOARD</button>
      </div>`;

    ov.classList.remove('hidden');
    document.getElementById('rc-close').onclick = () => ov.classList.add('hidden');
    document.getElementById('rc-share').onclick = () => shareGraphic(data);
    if (window.FX) FX.celebrate('#f5c451');
  }

  // ---------- shareable PNG ----------
  function shareGraphic(data) {
    const canvas = renderCard(data);
    canvas.toBlob(async (blob) => {
      const file = new File([blob], 'gridiron-draft-recap.png', { type: 'image/png' });
      // Try native share (mobile / some desktops)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'My Fantasy Draft Recap',
            text: 'Graded my fantasy draft with Gridiron Command 🏈' });
          return;
        } catch { /* fell through to download */ }
      }
      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'gridiron-draft-recap.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Recap image saved — share it in your league chat!');
    }, 'image/png');
  }

  function renderCard(data) {
    const W = 1080, H = 1080;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');

    // background
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#08131f'); g.addColorStop(0.5, '#0a2417'); g.addColorStop(1, '#060b16');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // yard lines
    x.strokeStyle = 'rgba(255,255,255,0.05)'; x.lineWidth = 2;
    for (let i = 1; i < 10; i++) { x.beginPath(); x.moveTo(0, i * H / 10); x.lineTo(W, i * H / 10); x.stroke(); }
    // border
    x.strokeStyle = 'rgba(245,196,81,0.5)'; x.lineWidth = 6; x.strokeRect(20, 20, W - 40, H - 40);

    const s = state.settings;
    const fmt = s.ppr === 1 ? 'FULL PPR' : s.ppr === 0.5 ? 'HALF PPR' : 'STANDARD';

    center(x, '🏈 GRIDIRON COMMAND', W / 2, 90, 'italic 900 46px Segoe UI, Arial', '#f5c451');
    center(x, 'DRAFT RECAP', W / 2, 140, '700 26px Segoe UI, Arial', '#e8eef6');
    center(x, `${s.teams}-TEAM · ${fmt}${s.qb === 2 ? ' · SUPERFLEX' : ''} · ${s.rounds} ROUNDS`, W / 2, 178, '600 20px Segoe UI, Arial', '#8fa0b5');

    // awards band
    const stealP = data.steal && data.steal.pk.delta > 2 ? PLAYERS[data.steal.pk.playerId] : null;
    const reachP = data.reach && data.reach.pk.delta < -3 ? PLAYERS[data.reach.pk.playerId] : null;
    award(x, 60, 210, (W - 160) / 2, '💎 STEAL', stealP ? stealP.name : 'No steals',
      stealP ? `${teamName(data.steal.pk.team)} · +${Math.round(data.steal.pk.delta)}` : 'drafted at value', '#3dd68c');
    award(x, W / 2 + 20, 210, (W - 160) / 2, '🧯 REACH', reachP ? reachP.name : 'Clean draft',
      reachP ? `${teamName(data.reach.pk.team)} · ${Math.round(data.reach.pk.delta)}` : 'no big reaches', '#e0526e');

    // standings
    let y = 380;
    center(x, 'POWER RANKINGS', W / 2, y, '700 24px Segoe UI, Arial', '#f5c451'); y += 40;
    const rowH = Math.min(64, (H - y - 90) / data.byGrade.length);
    data.byGrade.forEach((t, i) => {
      const ry = y + i * rowH;
      if (i === 0) { x.fillStyle = 'rgba(245,196,81,0.12)'; roundRect(x, 50, ry - rowH * 0.36, W - 100, rowH * 0.88, 10); x.fill(); }
      x.textAlign = 'left';
      x.font = '800 26px Segoe UI, Arial'; x.fillStyle = '#8fa0b5';
      x.fillText(['🥇', '🥈', '🥉'][i] || `${i + 1}`, 70, ry + 8);
      x.font = '700 26px Segoe UI, Arial'; x.fillStyle = '#e8eef6';
      x.fillText(clip(x, t.name, 360), 130, ry + 8);
      // grade bar
      const barX = 540, barW = 320;
      x.fillStyle = 'rgba(255,255,255,0.10)'; roundRect(x, barX, ry - 10, barW, 18, 9); x.fill();
      x.fillStyle = gradeColor(t.grade); roundRect(x, barX, ry - 10, barW * Math.max(0.05, t.avg / 100), 18, 9); x.fill();
      x.textAlign = 'right';
      x.font = '900 30px Segoe UI, Arial'; x.fillStyle = gradeColor(t.grade);
      x.fillText(t.grade, W - 150, ry + 9);
      x.font = '600 20px Segoe UI, Arial'; x.fillStyle = '#8fa0b5';
      x.fillText(`${t.projPts}`, W - 70, ry + 8);
    });

    x.textAlign = 'center';
    center(x, 'gridironcommand.app · grade your draft', W / 2, H - 45, '600 18px Segoe UI, Arial', '#8fa0b5');
    return c;

    function award(x, ax, ay, aw, label, name, det, col) {
      x.fillStyle = 'rgba(255,255,255,0.04)'; roundRect(x, ax, ay, aw, 140, 14); x.fill();
      x.strokeStyle = col; x.lineWidth = 2; roundRect(x, ax, ay, aw, 140, 14); x.stroke();
      x.textAlign = 'center';
      x.font = '800 20px Segoe UI, Arial'; x.fillStyle = col;
      x.fillText(label, ax + aw / 2, ay + 38);
      x.font = '800 30px Segoe UI, Arial'; x.fillStyle = '#fff';
      x.fillText(clip(x, name, aw - 40), ax + aw / 2, ay + 82);
      x.font = '600 18px Segoe UI, Arial'; x.fillStyle = '#8fa0b5';
      x.fillText(det, ax + aw / 2, ay + 116);
    }
  }

  // canvas helpers
  function center(x, t, cx, cy, font, color) { x.font = font; x.fillStyle = color; x.textAlign = 'center'; x.fillText(t, cx, cy); }
  function clip(x, t, maxW) { let s = t; while (x.measureText(s).width > maxW && s.length > 4) s = s.slice(0, -2); return s === t ? t : s + '…'; }
  function roundRect(x, rx, ry, w, h, r) { x.beginPath(); x.moveTo(rx + r, ry); x.arcTo(rx + w, ry, rx + w, ry + h, r); x.arcTo(rx + w, ry + h, rx, ry + h, r); x.arcTo(rx, ry + h, rx, ry, r); x.arcTo(rx, ry, rx + w, ry, r); x.closePath(); }
  function gradeColor(g) { const l = g[0]; return l === 'A' ? '#3dd68c' : l === 'B' ? '#a4e05a' : l === 'C' ? '#f5c451' : l === 'D' ? '#f08a3d' : '#e0526e'; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg) {
    let t = document.getElementById('gc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'gc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show';
    clearTimeout(t._t); t._t = setTimeout(() => t.className = '', 3500);
  }

  return { show, build };
})();
