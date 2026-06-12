<script lang="ts">
  const uid = $props.id();
</script>

<div class="card">
  <label for="{uid}-email">Email</label>
  <input id="{uid}-email" type="email" placeholder="you@example.com" />
  <p class="uid">$props.id(): <code>{uid}</code></p>
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin-top: 1rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2, var(--surface));
    color: var(--text);
  }
  .uid {
    margin: 0;
    flex-basis: 100%;
    color: var(--text-muted);
    font-size: 0.85em;
  }
</style>
