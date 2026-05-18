<script lang="ts">
  type Leaf = {
    x: number;
    y: number;
    size: number;
    depth: number;
    vy: number;
    vx: number;
    ax: number;
    ay: number;
    az: number;
    axSpeed: number;
    aySpeed: number;
    azSpeed: number;
    swayPhase: number;
    swayAmp: number;
    swayFreq: number;
    fill: string;
    vein: string;
    alpha: number;
  };

  const COLORS = [
    { fill: '#9ab8a3', vein: '#5d7a66' },
    { fill: '#b8d0bf', vein: '#6f8c78' },
    { fill: '#7fa089', vein: '#3f5b48' },
    { fill: '#a8c8b1', vein: '#56755e' },
    { fill: '#d8c884', vein: '#8e7c3b' },
  ];

  function makeFlake(W: number, H: number): Leaf {
    const c = COLORS[(Math.random() * COLORS.length) | 0]!;
    const size = 14 + Math.random() * 24;
    const depth = 0.35 + Math.random() * 0.65;
    return {
      x: Math.random() * W,
      y: -size - Math.random() * H * 0.5,
      size,
      depth,
      vy: 14 + depth * 22 + Math.random() * 8,
      vx: -(6 + depth * 10 + Math.random() * 5),
      ax: Math.random() * Math.PI * 2,
      ay: Math.random() * Math.PI * 2,
      az: (Math.random() - 0.5) * 0.6,
      axSpeed: 0.25 + Math.random() * 0.25,
      aySpeed: 0.2 + Math.random() * 0.25,
      azSpeed: (Math.random() - 0.5) * 0.18,
      swayPhase: Math.random() * Math.PI * 2,
      swayAmp: 3 + Math.random() * 6,
      swayFreq: 0.12 + Math.random() * 0.18,
      fill: c.fill,
      vein: c.vein,
      alpha: 0.55 + depth * 0.35,
    };
  }

  function drawFlake(ctx: CanvasRenderingContext2D, l: Leaf) {
    const sx = Math.cos(l.ay),
      sy = Math.cos(l.ax);
    const fx = sx >= 0 ? Math.max(sx, 0.08) : Math.min(sx, -0.08);
    const fy = sy >= 0 ? Math.max(sy, 0.08) : Math.min(sy, -0.08);
    ctx.save();
    ctx.globalAlpha = l.alpha;
    ctx.translate(l.x, l.y);
    ctx.rotate(l.az);
    ctx.scale(fx, fy);
    const s = l.size;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.55);
    ctx.bezierCurveTo(s * 0.55, -s * 0.5, s * 0.55, s * 0.4, 0, s * 0.55);
    ctx.bezierCurveTo(-s * 0.55, s * 0.4, -s * 0.55, -s * 0.5, 0, -s * 0.55);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -s * 0.55, 0, s * 0.55);
    g.addColorStop(0, l.fill);
    g.addColorStop(1, l.vein);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = l.vein;
    ctx.lineWidth = Math.max(0.5, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.lineTo(0, s * 0.5);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.4, s * 0.022);
    ctx.globalAlpha = l.alpha * 0.7;
    for (let i = -1; i <= 2; i++) {
      const t = i / 3;
      const y0 = -s * 0.4 + t * s * 0.8;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.quadraticCurveTo(s * 0.18, y0 + s * 0.08, s * 0.32, y0 + s * 0.18);
      ctx.moveTo(0, y0);
      ctx.quadraticCurveTo(-s * 0.18, y0 + s * 0.08, -s * 0.32, y0 + s * 0.18);
      ctx.stroke();
    }
    ctx.restore();
  }

  let canvas: HTMLCanvasElement;

  $effect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    let W = 0,
      H = 0;
    let leaves: Leaf[] = [];
    let last = performance.now();
    let running = true;
    let raf = 0;

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function targetCount() {
      return Math.min(22, Math.max(12, Math.floor((W * H) / 80000)));
    }

    function spawnAtEdge(l: Leaf) {
      if (Math.random() < 0.5) {
        l.x = Math.random() * W;
        l.y = -l.size - Math.random() * 80;
      } else {
        l.x = W + l.size + Math.random() * W * 0.08;
        l.y = Math.random() * H * 0.7;
      }
    }

    function seed() {
      leaves = [];
      const target = targetCount();
      for (let i = 0; i < target; i++) {
        const l = makeFlake(W, H);
        l.y = i === 0 ? -l.size : -l.size - Math.random() * H * 0.3;
        leaves.push(l);
      }
    }

    function rebalance() {
      const target = targetCount();
      while (leaves.length < target) {
        const l = makeFlake(W, H);
        spawnAtEdge(l);
        leaves.push(l);
      }
      while (leaves.length > target) {
        leaves.pop();
      }
    }

    function tick(now: number) {
      if (!running) {
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx!.clearRect(0, 0, W, H);
      for (const l of leaves) {
        l.swayPhase += l.swayFreq * dt * Math.PI * 2;
        const sway = Math.sin(l.swayPhase) * l.swayAmp;
        l.x += (l.vx + sway * 0.05) * dt;
        l.y += l.vy * dt;
        l.ax += l.axSpeed * dt;
        l.ay += l.aySpeed * dt;
        l.az += l.azSpeed * dt;
        if (l.x < -l.size * 1.5 || l.y > H + l.size * 1.5) {
          const fresh = makeFlake(W, H);
          spawnAtEdge(fresh);
          Object.assign(l, fresh);
        }
        drawFlake(ctx!, l);
      }
      raf = requestAnimationFrame(tick);
    }

    function onResize() {
      resize();
      rebalance();
    }
    function onVisibility() {
      running = !document.hidden;
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    seed();
    raf = requestAnimationFrame((t) => {
      last = t;
      tick(t);
    });

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
  canvas {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
  }
  @media (prefers-reduced-motion: reduce) {
    canvas {
      display: none;
    }
  }
</style>
