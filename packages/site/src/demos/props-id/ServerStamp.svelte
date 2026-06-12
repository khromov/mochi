<script lang="ts">
  const uid = $props.id();
</script>

<div class="card">
  <p>Rendered on demand in a separate request 🏝️</p>
  <p class="uid">$props.id(): <code>{uid}</code></p>
</div>

<style>
  .card {
    padding: 1rem 1.25rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin-top: 1rem;
  }
  p {
    margin: 0;
  }
  .uid {
    margin-top: 0.5rem;
    color: var(--text-muted);
    font-size: 0.85em;
  }
</style>
