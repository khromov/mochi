<script>
  import { onMount } from 'svelte';
  import { reloadDeferredIsland, deferReloadState } from 'mochi-framework';

  const rendered = deferReloadState('flaky');
  const offline = deferReloadState('offline');

  // Starts false so SSR and the first hydration render agree: no island has registered yet, so
  // `reloading` reads false and the buttons would otherwise ship enabled.
  let ready = $state(false);
  onMount(() => {
    ready = true;
  });

  const stamp = (s) => (s.lastReloaded ? `${s.lastReloadOk ? 'ok' : 'failed'} at ${s.lastReloaded.toLocaleTimeString()}` : 'not yet reloaded');

  // The island endpoint answers 200 even when the render throws, so breaking the request itself
  // is the only way to show a failed fetch.
  async function reloadOffline() {
    const real = window.fetch;
    window.fetch = (url, ...rest) => (String(url).includes('/_mochi/island/') ? Promise.reject(new Error('simulated network failure')) : real(url, ...rest));
    try {
      await reloadDeferredIsland('offline');
    } finally {
      window.fetch = real;
    }
  }
</script>

<div class="modes">
  <div class="mode">
    <button disabled={!ready || rendered.reloading} onclick={() => reloadDeferredIsland('flaky')}>Reload 4 — make the render throw</button>
    <p class="note">
      Island 4 throws about half the time. Its own <code>&lt;svelte:boundary&gt;</code> catches it, so the island degrades to its failed snippet and the rest of the page is
      untouched. The fetch itself was fine, so <code>lastReloadOk</code> stays <strong>true</strong>.
    </p>
    <p class="state">Island 4: {rendered.count} reloads · {stamp(rendered)}</p>
  </div>

  <div class="mode">
    <button disabled={!ready || offline.reloading} onclick={reloadOffline}>Reload 5 — make the fetch fail</button>
    <p class="note">
      This one breaks the request instead of the render. Nothing comes back to swap in, so the island keeps the content it already had and
      <code>lastReloadOk</code> flips to <strong>false</strong>. Note the timestamp on island 5 does not change.
    </p>
    <p class="state">Island 5: {offline.count} reloads · {stamp(offline)}</p>
  </div>
</div>

<style>
  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .mode {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    border-style: dashed;
    background: var(--surface-muted);
    color: var(--text-subtle);
  }

  .note {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text-subtle);
  }

  .state {
    margin: 0;
    font-size: 0.85rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-subtle);
  }
</style>
