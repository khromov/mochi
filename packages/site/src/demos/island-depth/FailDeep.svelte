<script>
  import AlwaysThrows from './AlwaysThrows.svelte';
  import ThrowsWhenInlined from './ThrowsWhenInlined.svelte';
</script>

<div class="level">
  <p><strong>FailDeep</strong> — this parent island's content stays intact while both children fail their inline attempt:</p>
  <AlwaysThrows mochi:defer>
    <div class="island-loading">Waiting for AlwaysThrows<span class="dots"></span></div>
  </AlwaysThrows>
  <ThrowsWhenInlined mochi:defer>
    <div class="island-loading">Waiting for ThrowsWhenInlined<span class="dots"></span></div>
  </ThrowsWhenInlined>
</div>

<style>
  .level {
    display: grid;
    gap: 0.6rem;
    padding: 0.85rem 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
  }

  .level > p {
    margin: 0;
  }

  .island-loading {
    padding: 0.85rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text-subtle);
    font-style: italic;
    text-align: center;
  }

  .dots::after {
    content: '';
    display: inline-block;
    width: 1.5em;
    text-align: left;
    animation: dots 1.2s steps(4, end) infinite;
  }

  @keyframes dots {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75% {
      content: '...';
    }
  }
</style>
