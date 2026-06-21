<script lang="ts">
  import type { Component } from 'svelte';
  import Sprout from '@lucide/svelte/icons/sprout';
  import PackageOpen from '@lucide/svelte/icons/package-open';
  import Layers from '@lucide/svelte/icons/layers';
  import Globe from '@lucide/svelte/icons/globe';
  import Snowflake from '@lucide/svelte/icons/snowflake';
  import Cookie from '@lucide/svelte/icons/cookie';
  import Link from '@lucide/svelte/icons/link';
  import Blend from '@lucide/svelte/icons/blend';
  import Tornado from '@lucide/svelte/icons/tornado';
  import DatabaseZap from '@lucide/svelte/icons/database-zap';
  import Barcode from '@lucide/svelte/icons/barcode';
  import Fingerprint from '@lucide/svelte/icons/fingerprint';
  import MessageCircle from '@lucide/svelte/icons/message-circle';
  import Webhook from '@lucide/svelte/icons/webhook';
  import FileDown from '@lucide/svelte/icons/file-down';
  import AudioWaveform from '@lucide/svelte/icons/audio-waveform';
  import ComponentIcon from '@lucide/svelte/icons/component';
  import Package2 from '@lucide/svelte/icons/package-2';
  import Telescope from '@lucide/svelte/icons/telescope';
  import Eye from '@lucide/svelte/icons/eye';
  import FileText from '@lucide/svelte/icons/file-text';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Hash from '@lucide/svelte/icons/hash';
  import ClipboardPen from '@lucide/svelte/icons/clipboard-pen';
  import Dices from '@lucide/svelte/icons/dices';
  import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import ShieldAlert from '@lucide/svelte/icons/shield-alert';
  import ListTodo from '@lucide/svelte/icons/list-todo';

  interface DemoLink {
    href: string;
    title: string;
    hook: string;
  }
  let { demos = [] }: { demos: DemoLink[] } = $props();

  // Keyed by href so the markdown only needs to pass { href, title, hook }.
  // Mirrors the icon choices in packages/site/src/lib/demoIcons.ts; duplicated
  // here to keep docs free of any dependency on the site package.
  const iconFor: Record<string, Component> = {
    '/demos/hello-world/': Sprout,
    '/demos/server-props/': PackageOpen,
    '/demos/hydration/': Layers,
    '/demos/data-loading/': Globe,
    '/demos/hydratable/': Snowflake,
    '/demos/cookies/': Cookie,
    '/demos/url/': Link,
    '/demos/view-transitions/': Blend,
    '/demos/custom-transitions/': Tornado,
    '/demos/cache-events/': DatabaseZap,
    '/demos/request-id/': Barcode,
    '/cookie-vary-test/': Fingerprint,
    '/demos/chat/': MessageCircle,
    '/demos/api/': Webhook,
    '/demos/file/': FileDown,
    '/demos/streams/': AudioWaveform,
    '/demos/server-island/': ComponentIcon,
    '/demos/island-props/': Package2,
    '/demos/lazy/': Telescope,
    '/demos/lazy-server-island/': Eye,
    '/demos/mdsvex/': FileText,
    '/demos/prop-dedup/': Boxes,
    '/demos/props-id/': Hash,
    '/demos/login/': ClipboardPen,
    '/demos/form-return-data/': Dices,
    '/demos/form-errors/': OctagonAlert,
    '/demos/error/': TriangleAlert,
    '/demos/error-boundaries/': ShieldAlert,
    'https://demos.mochi.fast/todo/': ListTodo,
  };
</script>

{#if demos.length > 0}
  <section class="see-it-in-action">
    <h2 class="sia-heading">See it in action</h2>
    <p class="sia-subtitle">Live demos showing key concepts from this page</p>
    <div class="sia-grid">
      {#each demos as demo (demo.href)}
        {@const external = demo.href.startsWith('http')}
        {@const Icon = iconFor[demo.href]}
        <a class="sia-card" href={demo.href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
          {#if Icon}
            <span class="sia-icon"><Icon size={16} strokeWidth={1.5} /></span>
          {/if}
          <span class="sia-title">{demo.title}</span>
          <span class="sia-hook">{demo.hook}</span>
        </a>
      {/each}
    </div>
  </section>
{/if}

<style>
  /* Card visual adapted from DemoPage.svelte .more-*. */
  .see-it-in-action {
    margin: 2.5rem 0 0;
  }
  .see-it-in-action .sia-heading {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    letter-spacing: -0.005em;
    color: var(--text);
    margin: 0 0 0.2rem;
  }
  .see-it-in-action .sia-subtitle {
    margin: 0 0 0.9rem;
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.4;
  }
  .sia-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
  }
  /* A lone card otherwise stretches the full row, which looks unbalanced. */
  .see-it-in-action .sia-card:only-child {
    max-width: 50%;
  }
  @media (max-width: 480px) {
    .see-it-in-action .sia-card:only-child {
      max-width: none;
    }
  }
  /* Nested under .see-it-in-action to outweigh the `.readme :global(a)`
     link styling (underline/accent color) that wraps doc content. */
  .see-it-in-action a.sia-card {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.85rem 0.9rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    color: inherit;
    text-decoration: none;
    transition:
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }
  .see-it-in-action a.sia-card:hover {
    transform: translateY(-2px);
    text-decoration: none;
    box-shadow:
      inset 3px 0 0 var(--accent),
      var(--shadow-md);
  }
  .sia-icon {
    color: var(--text-subtle);
    display: inline-flex;
    margin-bottom: 0.1rem;
  }
  .sia-title {
    font-family: var(--font-serif);
    font-size: 0.9rem;
    font-weight: 500;
    color: var(--text);
    letter-spacing: -0.005em;
    line-height: 1.3;
  }
  .see-it-in-action a.sia-card:hover .sia-title {
    color: var(--accent);
  }
  .sia-hook {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
  }
</style>
