<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import { Image } from 'mochi-framework/image';
  import codebayShot from './runs-on/codebay.webp';
  import gardenShot from './runs-on/garden.webp';
  import hnShot from './runs-on/hn.webp';
  import adminShot from './runs-on/admin.webp';
  import todoShot from './runs-on/todo.webp';

  const sites = [
    {
      href: 'https://codebay.stanislav.garden/',
      title: 'Codebay',
      hook: 'Devcontainer manager: isolated workspaces for coding agents, with a Mochi front end.',
      image: codebayShot,
      external: true,
    },
    {
      href: 'https://stanislav.garden/',
      title: 'stanislav.garden',
      hook: 'A personal site with an interactive header, server-rendered by Mochi.',
      image: gardenShot,
      external: true,
    },
    {
      href: 'https://demos.mochi.fast/hn',
      title: 'Hacker News Clone',
      hook: 'A full Hacker News reader: SSR pages, hydrated islands, real API.',
      image: hnShot,
      external: true,
    },
    {
      href: 'https://demos.mochi.fast/admin',
      title: 'Realtime Admin Panel',
      hook: 'Live dashboard with WebSocket updates and server-driven state.',
      image: adminShot,
      external: true,
    },
    {
      href: 'https://demos.mochi.fast/todo',
      title: 'Tailwind Todo App',
      hook: 'Classic todo app styled with Tailwind CSS.',
      image: todoShot,
      external: true,
    },
  ];

  let track: HTMLElement;
  let index = $state(0);
  let dragging = $state(false);
  let drag: { pointerId: number; x: number; scrollLeft: number; fromIndex: number; moved: boolean } | null = null;
  let suppressClick = false;

  function goTo(i: number) {
    const slide = track.children[Math.max(0, Math.min(i, sites.length - 1))] as HTMLElement | undefined;
    if (slide) {
      track.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
    }
  }

  function onScroll() {
    if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 1) {
      index = sites.length - 1;
      return;
    }
    let nearest = 0;
    let nearestDistance = Infinity;
    for (const [i, slide] of Array.from(track.children as HTMLCollectionOf<HTMLElement>).entries()) {
      const distance = Math.abs(slide.offsetLeft - track.scrollLeft);
      if (distance < nearestDistance) {
        nearest = i;
        nearestDistance = distance;
      }
    }
    index = nearest;
  }

  // Touch and pen scroll the track natively; only the mouse needs drag-to-scroll.
  function onPointerDown(e: PointerEvent) {
    suppressClick = false;
    if (e.pointerType !== 'mouse' || e.button !== 0) {
      return;
    }
    drag = { pointerId: e.pointerId, x: e.clientX, scrollLeft: track.scrollLeft, fromIndex: index, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) {
      return;
    }
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 4) {
      return;
    }
    if (!drag.moved) {
      // Capturing on pointerdown would retarget the pointerup, and with it the click, away from the link.
      try {
        track.setPointerCapture(drag.pointerId);
      } catch {
        // Without capture the drag still works while the cursor stays over the track.
      }
    }
    drag.moved = true;
    dragging = true;
    track.scrollLeft = drag.scrollLeft - dx;
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) {
      return;
    }
    const { fromIndex, moved } = drag;
    const dx = e.clientX - drag.x;
    if (track.hasPointerCapture(drag.pointerId)) {
      track.releasePointerCapture(drag.pointerId);
    }
    drag = null;
    dragging = false;
    suppressClick = moved;
    if (moved) {
      goTo(Math.abs(dx) > 60 ? fromIndex - Math.sign(dx) : fromIndex);
    }
  }

  function onClickCapture(e: MouseEvent) {
    if (suppressClick) {
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<div class="carousel">
  <ul
    class="track"
    class:dragging
    bind:this={track}
    onscroll={onScroll}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onclickcapture={onClickCapture}
  >
    {#each sites as site (site.href)}
      <li class="slide">
        <a class="shot" href={site.href} target={site.external ? '_blank' : undefined} rel={site.external ? 'noopener noreferrer' : undefined} draggable="false">
          <span class="bar" aria-hidden="true">
            <span class="dots"><span></span><span></span><span></span></span>
            <span class="url">{site.title}</span>
          </span>
          <Image src={site.image} size="site-shot" alt="Screenshot of {site.title}" placeholder class="shot-img" />
        </a>
        <p class="caption">
          <a class="caption-title" href={site.href} target={site.external ? '_blank' : undefined} rel={site.external ? 'noopener noreferrer' : undefined}>
            {site.title}
            {#if site.external}<ArrowUpRight size={14} strokeWidth={2} aria-label="(opens in a new tab)" />{/if}
          </a>
          <span class="caption-hook">{site.hook}</span>
        </p>
      </li>
    {/each}
  </ul>

  <div class="controls">
    <button type="button" class="arrow" aria-label="Previous site" disabled={index === 0} onclick={() => goTo(index - 1)}>
      <ArrowLeft size={16} strokeWidth={2} />
    </button>
    <ol class="pager" aria-label="Sites">
      {#each sites as site, i (site.href)}
        <li>
          <button type="button" class="dot" aria-label="Show {site.title}" aria-current={i === index ? 'true' : undefined} onclick={() => goTo(i)}></button>
        </li>
      {/each}
    </ol>
    <button type="button" class="arrow" aria-label="Next site" disabled={index === sites.length - 1} onclick={() => goTo(index + 1)}>
      <ArrowRight size={16} strokeWidth={2} />
    </button>
  </div>
</div>

<style>
  .carousel {
    display: grid;
    gap: 1.25rem;
  }

  .track {
    --slide: 62%;
    position: relative;
    list-style: none;
    margin: 0;
    padding: 0.25rem 0;
    display: flex;
    gap: 1.25rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
  }

  @media (hover: hover) {
    .track {
      cursor: grab;
    }
  }

  .track.dragging {
    cursor: grabbing;
    scroll-snap-type: none;
    user-select: none;
  }

  .track.dragging .shot,
  .track.dragging .caption-title {
    pointer-events: none;
  }

  .track::-webkit-scrollbar {
    display: none;
  }

  .track::after {
    content: '';
    flex: 0 0 calc(100% - var(--slide));
  }

  .slide {
    flex: 0 0 var(--slide);
    min-width: 0;
    scroll-snap-align: start;
    display: grid;
    gap: 0.75rem;
  }

  .shot {
    display: block;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
    text-decoration: none;
    box-shadow: 0 1px 0 var(--border);
    transition: border-color 0.15s ease;
  }

  .shot:hover {
    border-color: var(--accent);
  }

  .shot:focus-visible,
  .caption-title:focus-visible,
  .arrow:focus-visible,
  .dot:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.75rem;
    background: var(--surface-muted);
    border-bottom: 1px solid var(--border);
  }

  .dots {
    display: inline-flex;
    gap: 0.3rem;
  }

  .dots span {
    width: 0.55rem;
    height: 0.55rem;
    border-radius: 50%;
    background: var(--border-strong);
  }

  .url {
    flex: 1;
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
    background: var(--surface);
    border: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-subtle);
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .shot :global(.shot-img) {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1280 / 800;
    object-fit: cover;
    object-position: top;
    -webkit-user-drag: none;
    user-select: none;
  }

  .caption {
    display: grid;
    gap: 0.15rem;
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .caption-title {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    width: fit-content;
    font-weight: 600;
    color: var(--text);
    text-decoration: none;
  }

  .caption-title:hover {
    color: var(--accent);
  }

  .caption-hook {
    color: var(--text-muted);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }

  .arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      color 0.15s ease,
      opacity 0.15s ease;
  }

  .arrow:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .arrow:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .pager {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 0.5rem;
  }

  .dot {
    display: block;
    width: 0.6rem;
    height: 0.6rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--border-strong);
    cursor: pointer;
    transition:
      background-color 0.15s ease,
      transform 0.15s ease;
  }

  .dot[aria-current='true'] {
    background: var(--accent);
    transform: scale(1.25);
  }

  @media (max-width: 1024px) {
    .track {
      --slide: 78%;
    }
  }

  @media (max-width: 720px) {
    .track {
      --slide: 88%;
      gap: 0.75rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .track {
      scroll-behavior: auto;
    }
  }
</style>
