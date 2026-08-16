<script lang="ts">
  import { PROTECTION_SHELL_COMPONENT } from 'mochi-framework';

  // Read from the installed framework at render time, so the snippet can never drift from the shipped default.
  const source = (await Bun.file(PROTECTION_SHELL_COMPONENT).text()).trimEnd();

  // Reuse the host site's pinned highlighter when one exists — docs components must not import site code.
  type Highlighter = (code: string, lang?: string) => string | Promise<string>;
  const highlight = (globalThis as Record<string, unknown>)['__mochi_site_highlight__'] as Highlighter | undefined;
  const highlighted = highlight ? await highlight(source, 'svelte') : null;
</script>

{#if highlighted}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html highlighted}
{:else}
  <div class="code-block"><pre><code>{source}</code></pre></div>
{/if}
