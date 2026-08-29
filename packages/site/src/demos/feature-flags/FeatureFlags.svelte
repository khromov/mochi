<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import ResetButton from './ResetButton.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  let { flags = [], cookie = null }: { flags?: { name: string; on: boolean }[]; cookie?: string | null } = $props();

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Feature Flags"
  description="Per-user flags declared in the Mochi.serve features option and checked with Mochi.feature(). Assignment is sticky and deterministic — the same user always sees the same state — and is carried by an encrypted, opaque mochi_ff cookie."
  {sources}
>
  <div class="ff">
    <div class="section">
      <h3>Your flags <span class="env">(evaluated during SSR)</span></h3>
      <div class="flags">
        {#each flags as flag (flag.name)}
          <div class="flag">
            <code class="name">{flag.name}</code>
            <span class="state" class:on={flag.on}>{flag.on ? 'ON' : 'OFF'}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="section">
      <h3>Your assignment cookie</h3>
      <p class="desc">
        The <code>mochi_ff</code> cookie holds only an encrypted, opaque bucketing seed — never the list of flags you're in.
      </p>
      <code class="token">{cookie ?? '(minted this request — reload to see the mochi_ff cookie value)'}</code>
    </div>

    <div class="section">
      <p class="desc">Reload the page: your flags stay the same. Re-roll to get a fresh assignment.</p>
      <ResetButton mochi:hydrate />
    </div>
  </div>
</DemoPage>

<style>
  .ff {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .section h3 {
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
    color: var(--text);
  }

  .env {
    font-weight: 400;
    color: var(--text-subtle);
    font-size: 0.85rem;
  }

  .desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin-bottom: 0.6rem;
  }

  .desc code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .flags {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .flag {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .flag .name {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .state {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 700;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--surface-muted);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .state.on {
    background: var(--badge-success-bg);
    color: var(--badge-success-text);
    border-color: var(--badge-success-text);
  }

  .token {
    display: block;
    word-break: break-all;
    background: var(--code-bg);
    color: var(--text-muted);
    font-family: var(--font-mono);
    padding: 0.55rem 0.7rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    border: 1px solid var(--border);
  }
</style>
