<script lang="ts">
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import SunMoon from '@lucide/svelte/icons/sun-moon';

  type Theme = 'auto' | 'light' | 'dark';

  const NEXT: Record<Theme, Theme> = {
    auto: 'light',
    light: 'dark',
    dark: 'auto',
  };

  const LABEL: Record<Theme, string> = {
    auto: 'Theme: auto (follows system). Click for light.',
    light: 'Theme: light. Click for dark.',
    dark: 'Theme: dark. Click for auto.',
  };

  let { compact = false }: { compact?: boolean } = $props();

  let theme = $state<Theme>('auto');
  let mounted = $state(false);

  function resolveInitial(): Theme {
    if (typeof window === 'undefined') {
      return 'auto';
    }
    try {
      const stored = localStorage.getItem('mochi-theme');
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      /* storage blocked */
    }
    return 'auto';
  }

  function apply(next: Theme) {
    const root = document.documentElement;
    if (next === 'auto') {
      root.removeAttribute('data-theme');
      try {
        localStorage.removeItem('mochi-theme');
      } catch {
        /* storage blocked */
      }
    } else {
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('mochi-theme', next);
      } catch {
        /* storage blocked */
      }
    }
  }

  $effect(() => {
    theme = resolveInitial();
    mounted = true;
  });

  function toggle() {
    const next = NEXT[theme];
    theme = next;
    apply(next);
  }
</script>

<button type="button" class="theme-toggle" class:compact data-theme-state={theme} aria-label={LABEL[theme]} title={LABEL[theme]} onclick={toggle}>
  <span class="icon" aria-hidden="true">
    {#if !mounted}
      <span class="icon-placeholder"></span>
    {:else if theme === 'auto'}
      <SunMoon size={16} strokeWidth={1.6} />
    {:else if theme === 'dark'}
      <Moon size={16} strokeWidth={1.6} />
    {:else}
      <Sun size={16} strokeWidth={1.6} />
    {/if}
  </span>
</button>

<style>
  .theme-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.12s ease,
      background 0.12s ease,
      border-color 0.12s ease,
      transform 0.2s ease;
  }

  .theme-toggle:hover {
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    border-color: var(--accent);
  }

  .theme-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .theme-toggle:active .icon {
    transform: scale(0.92);
  }

  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s ease;
  }

  .icon-placeholder {
    display: inline-block;
    width: 16px;
    height: 16px;
  }

  .compact {
    width: 30px;
    height: 30px;
  }
</style>
