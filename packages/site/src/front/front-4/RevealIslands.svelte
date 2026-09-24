<script lang="ts">
  import { onMount } from 'svelte';

  type Island = { name: string; lazy: boolean };
  type Badge = { name: string; top: number; left: number };

  let on = $state(false);
  let islands = $state<Island[]>([]);
  let badges = $state<Badge[]>([]);

  const nameOf = (el: Element) => (el.getAttribute('component-name') ?? 'Island').replace(/_[a-z0-9]+$/i, '');
  const allIslands = () => Array.from(document.querySelectorAll('mochi-hydratable-island'));

  function place(overlay: HTMLElement) {
    const origin = overlay.getBoundingClientRect();
    const next: Badge[] = [];
    for (const island of allIslands()) {
      const el = island.firstElementChild;
      if (!el || getComputedStyle(el).position === 'fixed') {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) {
        continue;
      }
      next.push({ name: nameOf(island), top: Math.max(r.top - 26, 4) - origin.top, left: Math.max(r.left - 3, 4) - origin.left });
    }
    badges = next;
  }

  function trackIslands(overlay: HTMLElement) {
    let frame = 0;
    const schedule = () => {
      if (frame) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        place(overlay);
      });
    };
    schedule();
    addEventListener('scroll', schedule, { passive: true });
    addEventListener('resize', schedule);
    return () => {
      removeEventListener('scroll', schedule);
      removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }

  onMount(() => {
    islands = allIslands().map((el) => ({ name: nameOf(el), lazy: el.getAttribute('hydrate-on') === 'visible' }));
    return () => document.documentElement.classList.remove('reveal-islands');
  });

  $effect(() => {
    document.documentElement.classList.toggle('reveal-islands', on);
  });
</script>

<div class="reveal">
  <button type="button" class="switch" role="switch" aria-checked={on} onclick={() => (on = !on)}>
    <span class="track" aria-hidden="true"><span class="knob"></span></span>
    <span class="switch-label">{on ? 'Islands revealed' : 'Reveal islands'}</span>
  </button>
  <p class="count">
    {#if islands.length}
      <strong>{islands.length}</strong> islands on this page
    {:else}
      Counting islands…
    {/if}
  </p>
  {#if on && islands.length}
    <ul class="names">
      {#each islands as island, i (i)}
        <li>
          {island.name}{#if island.lazy}<span class="lazy">:visible</span>{/if}
        </li>
      {/each}
    </ul>
  {/if}
  {#if on}
    <div class="overlay" aria-hidden="true" {@attach trackIslands}>
      {#each badges as badge, i (i)}
        <span class="badge" style:top="{badge.top}px" style:left="{badge.left}px">{badge.name}</span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .reveal {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .switch {
    display: inline-flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .switch:focus-visible {
    outline: 3px solid #f7df1e;
    outline-offset: 4px;
  }

  .track {
    position: relative;
    flex: none;
    width: 76px;
    height: 40px;
    border: 3px solid currentColor;
    transition: background 0.2s ease;
  }

  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 28px;
    height: 28px;
    background: currentColor;
    transition: transform 0.22s cubic-bezier(0.3, 0.7, 0.2, 1);
  }

  .switch[aria-checked='true'] .track {
    background: #f7df1e;
    border-color: #0a0a0a;
  }

  .switch[aria-checked='true'] .knob {
    background: #0a0a0a;
    transform: translateX(36px);
  }

  .switch-label {
    font-size: 1.35rem;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .count {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.85rem;
  }

  .count strong {
    font-weight: 500;
    background: #f7df1e;
    color: #0a0a0a;
    padding: 0 0.3em;
  }

  .names {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    list-style: none;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.75rem;
  }

  .names li {
    padding: 0.15rem 0.45rem;
    background: #f7df1e;
    color: #0a0a0a;
  }

  .lazy {
    opacity: 0.6;
  }

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    pointer-events: none;
  }

  .badge {
    position: absolute;
    padding: 0.1rem 0.4rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1.5;
    white-space: nowrap;
    background: #f7df1e;
    color: #0a0a0a;
    box-shadow: 0 0 0 1px #0a0a0a;
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
