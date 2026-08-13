<script lang="ts">
  import semver from 'semver';
  import mochiPkg from 'mochi-framework/package.json' with { type: 'json' };

  let { since, message, href }: { since: string; message?: string; href?: string } = $props();

  const installed = semver.coerce(mochiPkg.version)?.version ?? mochiPkg.version;
  const isOlder = $derived(semver.valid(installed) ? semver.lt(installed, since) : false);
  const warning = $derived(message ?? `This API changed in ${since}.`);
</script>

{#if isOlder}
  <p class="version-note-warning" role="note">{warning}</p>
{:else if href}
  <p class="version-note-since"><a {href} class="version-note-link">Available since: {since}</a></p>
{:else}
  <p class="version-note-since">Available since: {since}</p>
{/if}

<style>
  .version-note-warning {
    margin: 0.5rem 0 1rem;
    padding: 0.35rem 0.6rem;
    font-size: 0.8rem;
    line-height: 1.4;
    border: 2px solid var(--badge-warning-text);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--badge-warning-bg) 40%, var(--surface));
    color: var(--text);
  }

  .version-note-since {
    margin: 0.25rem 0 1rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .version-note-since .version-note-link {
    color: var(--text-muted);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-decoration-color: currentColor;
    text-underline-offset: 2px;
  }
</style>
