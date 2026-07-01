<script lang="ts">
  import type { ClientOnlyProps } from 'mochi-framework';

  let { waves = 3 }: ClientOnlyProps<{ waves?: number }> = $props();

  // These top-level browser reads would crash an SSR render — safe here
  // because mochi:clientOnly components never run on the server.
  const dpr = window.devicePixelRatio;
  const theme = getComputedStyle(document.documentElement);
  const accent = theme.getPropertyValue('--accent').trim();
  const textMuted = theme.getPropertyValue('--text-muted').trim();

  let canvas: HTMLCanvasElement;

  $effect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    let width = 0;
    let height = 0;
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      // Re-setting canvas.width wipes the context state, so re-apply the
      // dpr scale absolutely instead of accumulating ctx.scale() calls.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame: number;
    let frames = 0;
    let lastFpsUpdate = 0;
    let fps = 0;
    const draw = (t: number) => {
      frames++;
      if (t - lastFpsUpdate >= 500) {
        fps = Math.round((frames * 1000) / (t - lastFpsUpdate));
        frames = 0;
        lastFpsUpdate = t;
      }
      ctx.clearRect(0, 0, width, height);
      for (let line = 0; line < waves; line++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
          const y = height / 2 + Math.sin(x / 60 + t / (600 + line * 200)) * (height / 4) * Math.sin(t / 2000 + line);
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 1 - (line / waves) * 0.75;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = textMuted;
      ctx.font = '12px ui-monospace, monospace';
      if (fps > 0) {
        ctx.fillText(`${fps} fps`, 12, height - 12);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
</script>

<canvas bind:this={canvas}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 160px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }
</style>
