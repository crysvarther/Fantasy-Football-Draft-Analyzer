// ============================================================
// FX ENGINE — 3D perspective football field + stadium particles
// ============================================================
(function () {
  const canvas = document.getElementById('fx-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, t = 0;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Floating stadium particles (light bokeh / confetti dust)
  const particles = Array.from({ length: 90 }, (_, i) => ({
    x: Math.random() * 2000,
    y: Math.random() * 1200,
    z: 0.2 + Math.random() * 0.8,
    r: 0.6 + Math.random() * 2.2,
    sp: 0.1 + Math.random() * 0.4,
    hue: Math.random() < 0.5 ? 145 : 45   // field green / gold
  }));

  // Celebration burst particles (spawned on big picks)
  let bursts = [];
  window.FX = {
    celebrate(color) {
      const cx = W / 2, cy = H / 2;
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 2 + Math.random() * 9;
        bursts.push({
          x: cx, y: cy,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3,
          life: 1, color: color || `hsl(${Math.random() * 60 + 20},100%,60%)`
        });
      }
    },
    boo() {
      for (let i = 0; i < 50; i++) {
        bursts.push({
          x: Math.random() * W, y: -10,
          vx: (Math.random() - 0.5) * 1.5, vy: 1 + Math.random() * 3,
          life: 1, color: 'hsla(0,80%,45%,0.8)'
        });
      }
    }
  };

  function drawField() {
    const cam = window.__cam ? window.__cam() : { x: 0, y: 0 };
    const camX = cam.x * 40;                    // vanishing point sways with the camera
    const horizon = H * 0.42 + cam.y * 16;      // camera pitch nudges the horizon

    // Night sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#02040a');
    sky.addColorStop(1, '#0a1626');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);

    // Field gradient
    const grass = ctx.createLinearGradient(0, horizon, 0, H);
    grass.addColorStop(0, '#0a2818');
    grass.addColorStop(0.5, '#0d3a20');
    grass.addColorStop(1, '#0a2f1a');
    ctx.fillStyle = grass;
    ctx.fillRect(0, horizon, W, H - horizon);

    // Perspective yard lines scrolling toward viewer
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    const scroll = (t * 0.25) % 1;
    for (let i = 0; i < 14; i++) {
      const p = (i + scroll) / 14;
      const y = horizon + Math.pow(p, 2.2) * (H - horizon);
      const alpha = 0.03 + Math.pow(p, 2) * 0.16;
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth = 1 + p * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Converging sidelines + hash columns
    const vpx = W / 2 + camX;
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      ctx.strokeStyle = `rgba(255,255,255,${i === -6 || i === 6 ? 0.18 : 0.05})`;
      ctx.beginPath();
      ctx.moveTo(vpx + i * 30, horizon);
      ctx.lineTo(vpx + i * (W / 9), H);
      ctx.stroke();
    }

    // Floodlight beams
    for (const [bx, dir] of [[W * 0.08 + camX * 0.5, 1], [W * 0.92 + camX * 0.5, -1]]) {
      const g = ctx.createLinearGradient(bx, 0, bx + dir * W * 0.3, horizon + 200);
      g.addColorStop(0, 'rgba(200,230,255,0.10)');
      g.addColorStop(1, 'rgba(200,230,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx, -10);
      ctx.lineTo(bx + dir * W * 0.45, horizon + 260);
      ctx.lineTo(bx + dir * W * 0.13, horizon + 260);
      ctx.closePath();
      ctx.fill();
    }

    // Stadium crowd shimmer along horizon
    for (let i = 0; i < 60; i++) {
      const x = (i / 60) * W;
      const tw = Math.sin(t * 3 + i * 7.3) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255,240,200,${0.04 + tw * 0.09})`;
      ctx.fillRect(x, horizon - 14 + Math.sin(i * 3.1) * 6, 2, 2);
    }

    // Atmospheric fog band at the horizon — separates far stands from field
    const fog = ctx.createLinearGradient(0, horizon - 30, 0, horizon + 70);
    fog.addColorStop(0, 'rgba(120,150,180,0)');
    fog.addColorStop(0.5, 'rgba(120,150,180,0.10)');
    fog.addColorStop(1, 'rgba(120,150,180,0)');
    ctx.fillStyle = fog;
    ctx.fillRect(0, horizon - 30, W, 100);

    // Foreground darkening at the near edge — frames the depth
    const near = ctx.createLinearGradient(0, H - 130, 0, H);
    near.addColorStop(0, 'rgba(0,0,0,0)');
    near.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = near;
    ctx.fillRect(0, H - 130, W, 130);
  }

  function drawParticles() {
    for (const p of particles) {
      p.y -= p.sp;
      if (p.y < -10) { p.y = H + 10; p.x = Math.random() * 2000; }
      const x = (p.x * (W / 2000) + Math.sin(t + p.x) * 12) % W;
      ctx.fillStyle = `hsla(${p.hue},80%,65%,${0.10 * p.z})`;
      ctx.beginPath();
      ctx.arc(x, p.y * (H / 1200), p.r * p.z * 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBursts() {
    bursts = bursts.filter(b => b.life > 0);
    for (const b of bursts) {
      b.x += b.vx; b.y += b.vy; b.vy += 0.15; b.life -= 0.012;
      ctx.globalAlpha = Math.max(0, b.life);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, 5, 5);
    }
    ctx.globalAlpha = 1;
  }

  function loop() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);
    drawField();
    drawParticles();
    drawBursts();
    requestAnimationFrame(loop);
  }
  loop();
})();
