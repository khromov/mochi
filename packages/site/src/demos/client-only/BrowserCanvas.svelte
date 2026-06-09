<script lang="ts">
  import type { Snippet } from 'svelte';

  // `children` is never passed at runtime — fallback children are an SSR-only
  // placeholder — but the invocation type-checks against the props type.
  let { hue = 260 } = $props<{ hue?: number; children?: Snippet }>();

  // These top-level browser reads would crash an SSR render — safe here
  // because mochi:clientOnly components never run on the server.
  const dpr = window.devicePixelRatio;
  const cores = navigator.hardwareConcurrency;

  let canvas: HTMLCanvasElement;

  $effect(() => {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let frame: number;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);
      for (let line = 0; line < 3; line++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
          const y = height / 2 + Math.sin(x / 60 + t / (600 + line * 200)) * (height / 4) * Math.sin(t / 2000 + line);
          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = `hsl(${hue + line * 30} 80% ${60 - line * 10}%)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="browser-canvas">
  <canvas bind:this={canvas}></canvas>
  <p class="facts">
    Drawn at {dpr}x pixel density on a {cores}-core machine — values read straight from <code>window</code> and <code>navigator</code> at the top of the script.
  </p>
</div>

<style>
  .browser-canvas {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  canvas {
    width: 100%;
    height: 160px;
    background: var(--surface-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
  }

  .facts {
    font-size: 0.85rem;
    color: var(--text-muted);
  }
</style>
