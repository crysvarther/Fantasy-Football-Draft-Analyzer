// ============================================================
// CHEER SQUAD — stylized silhouette celebration line.
// Broadcast-graphic pom-pom squad that runs a synchronized routine
// along the bottom edge for steals (A/A+ picks) and draft completion.
// Pure SVG + CSS, no assets. Toggleable in setup (settings.cheer).
// ============================================================
const Cheer = (function () {
  const SQUAD_SIZE = 6;
  let wrap = null;
  let hideTimer = null;

  // One stylized silhouette figure: head, torso, arms up, kick leg,
  // fluffy pom-poms. Deliberately abstract — a graphics-package glyph.
  function figureSVG(i) {
    const pom = (cx, cy) => `
      <g class="pom">
        <circle cx="${cx}" cy="${cy}" r="7"/>
        <circle cx="${cx - 5}" cy="${cy + 3}" r="5"/>
        <circle cx="${cx + 5}" cy="${cy + 3}" r="5"/>
        <circle cx="${cx}" cy="${cy + 6}" r="5"/>
      </g>`;
    return `
    <svg class="cheer-fig" style="--i:${i}" viewBox="0 0 80 110" aria-hidden="true">
      <g class="fig-body">
        <!-- pom-poms -->
        ${pom(12, 22)}
        ${pom(68, 22)}
        <!-- arms raised in a V -->
        <path class="sil" d="M40 48 L17 27 M40 48 L63 27" stroke-width="9.5" fill="none" stroke-linecap="round"/>
        <!-- head -->
        <circle class="sil-fill" cx="40" cy="28" r="11.5"/>
        <!-- torso + skirt flare -->
        <path class="sil-fill" d="M40 39 L31 60 L23 75 L57 75 L49 60 Z"/>
        <!-- standing leg -->
        <path class="sil" d="M36 75 L34 101" stroke-width="9.5" fill="none" stroke-linecap="round"/>
        <!-- kick leg (animated) -->
        <path class="sil kick-leg" d="M46 75 L58 95" stroke-width="9.5" fill="none" stroke-linecap="round"/>
      </g>
    </svg>`;
    // (kick-leg transform-origin lives in CSS: 46px 75px)
  }

  function build() {
    wrap = document.createElement('div');
    wrap.id = 'cheer-squad';
    wrap.className = 'hidden';
    wrap.innerHTML = Array.from({ length: SQUAD_SIZE }, (_, i) => figureSVG(i)).join('');
    document.body.appendChild(wrap);
  }

  // color: accent for the pom-poms (defaults to broadcast gold)
  function show(color, durationMs) {
    if (!state.settings.cheer) return;
    if (!wrap) build();
    wrap.style.setProperty('--pom-c', color || 'var(--gold)');
    wrap.classList.remove('hidden');
    // restart the routine
    wrap.classList.remove('run');
    void wrap.offsetWidth;
    wrap.classList.add('run');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => wrap.classList.add('hidden'), durationMs || 4200);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (wrap) wrap.classList.add('hidden');
  }

  return { show, hide };
})();
