// ============================================================
// PARALLAX CAMERA — drives a shared 3D "camera" from pointer / device tilt.
// Publishes smoothed values as CSS custom properties (--parx/--pary and
// pixel offsets) that the board, background, and foreground layers read.
// fx.js reads the smoothed camera via window.__cam() for the field.
// ============================================================
(function () {
  const root = document.documentElement;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let tx = 0, ty = 0, cx = 0, cy = 0;         // target & smoothed, normalized -1..1
  const clamp = v => Math.max(-1, Math.min(1, v));
  function set(px, py) { tx = clamp(px); ty = clamp(py); }

  window.__cam = () => ({ x: cx, y: cy });

  if (reduce) {
    root.style.setProperty('--parx', '0');
    root.style.setProperty('--pary', '0');
    return;
  }

  window.addEventListener('pointermove', e => {
    set((e.clientX / innerWidth - 0.5) * 2, (e.clientY / innerHeight - 0.5) * 2);
  }, { passive: true });

  // let the pointer drift back to center when it leaves the window
  window.addEventListener('pointerleave', () => set(0, 0), { passive: true });

  // device tilt (tablets / motion-capable TVs)
  window.addEventListener('deviceorientation', e => {
    if (e.gamma == null || e.beta == null) return;
    set(clamp(e.gamma / 28), clamp((e.beta - 45) / 28));
  }, { passive: true });

  function loop() {
    cx += (tx - cx) * 0.06;                    // easing = weighty camera
    cy += (ty - cy) * 0.06;
    root.style.setProperty('--parx', cx.toFixed(3));
    root.style.setProperty('--pary', cy.toFixed(3));
    root.style.setProperty('--par-bgx', (cx * -20).toFixed(1) + 'px');
    root.style.setProperty('--par-bgy', (cy * -14).toFixed(1) + 'px');
    root.style.setProperty('--par-fgx', (cx * 34).toFixed(1) + 'px');
    root.style.setProperty('--par-fgy', (cy * 24).toFixed(1) + 'px');
    requestAnimationFrame(loop);
  }
  loop();
})();
