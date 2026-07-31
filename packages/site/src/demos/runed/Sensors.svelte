<script lang="ts">
  import { PressedKeys, IsIdle, AnimationFrames } from 'runed';
  import Badge from '../../components/Badge.svelte';

  const keys = new PressedKeys();

  const idle = new IsIdle({ timeout: 2000 });

  let frames = $state(0);
  let fpsLimit = $state(30);
  const animation = new AnimationFrames(() => frames++, { fpsLimit: () => fpsLimit });
</script>

<div class="grid">
  <div class="panel">
    <div class="head">
      <h3>PressedKeys</h3>
      <span class="hint">hold any keys — try Ctrl + Shift</span>
    </div>
    <div class="keys">
      {#if keys.all.length === 0}
        <span class="empty">No keys pressed</span>
      {:else}
        {#each keys.all as key (key)}
          <kbd>{key}</kbd>
        {/each}
      {/if}
    </div>
  </div>

  <div class="panel">
    <div class="head">
      <h3>IsIdle</h3>
      <span class="hint">stop moving the mouse for 2s</span>
    </div>
    {#if idle.current}
      <Badge kind="warning">idle</Badge>
    {:else}
      <Badge kind="success">active</Badge>
    {/if}
    <p class="meta">Last active: <code>{new Date(idle.lastActive).toLocaleTimeString()}</code></p>
  </div>

  <div class="panel">
    <div class="head">
      <h3>AnimationFrames</h3>
      <span class="hint">rAF loop with an FPS cap</span>
    </div>
    <div class="fps">
      <code>{Math.round(animation.fps)} fps</code>
      <span class="meta">{frames} frames</span>
    </div>
    <label class="slider">
      <span>Limit: {fpsLimit} fps</span>
      <input type="range" min="1" max="60" bind:value={fpsLimit} />
    </label>
    <button onclick={() => (animation.running ? animation.stop() : animation.start())}>
      {animation.running ? 'Stop' : 'Start'}
    </button>
  </div>
</div>

<style>
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    align-items: flex-start;
  }

  .head {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .head h3 {
    font-size: 0.95rem;
    font-weight: 700;
    margin: 0;
    color: var(--text);
  }

  .hint {
    font-size: 0.75rem;
    color: var(--text-subtle);
  }

  .keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    min-height: 2rem;
    align-items: center;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.2rem 0.5rem;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: 4px;
    background: var(--surface);
    color: var(--text);
  }

  .empty {
    font-size: 0.9rem;
    color: var(--text-subtle);
  }

  .fps {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .slider {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    width: 100%;
  }

  .slider input {
    width: 100%;
  }

  button {
    padding: 0.4rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease;
  }

  button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .meta {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0;
  }
</style>
