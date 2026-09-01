<script lang="ts">
  import Field from './Field.svelte';
  import type { MochiDirectives } from 'mochi-framework';

  let {}: MochiDirectives = $props();

  let value = $state('');
</script>

<Field>
  {#snippet children(uid)}
    <label for="{uid}-name">Name</label>
    <input id="{uid}-name" type="text" bind:value placeholder="Type here…" />
    <button onclick={() => document.getElementById(`${uid}-name`)?.focus()}>Focus input via its id</button>
  {/snippet}
</Field>

<style>
  input {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2, var(--surface));
    color: var(--text);
  }
  button {
    padding: 0.4rem 0.8rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--surface-2, var(--surface));
    color: var(--text);
    cursor: pointer;
  }
</style>
