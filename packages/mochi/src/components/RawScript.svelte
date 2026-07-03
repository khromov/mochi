<script lang="ts">
  import { readFileSync } from 'node:fs';
  import { isHydratable } from 'mochi-framework';

  let {
    src,
    string,
  }: {
    src?: string;
    string?: string;
  } = $props();

  // Read the context at init (getContext can't run inside a $derived).
  const hydrating = isHydratable();

  const content = $derived.by(() => {
    if (hydrating) {
      throw new Error('<RawScript /> must not be hydrated — it inlines file contents during SSR only. Remove the mochi: directives.');
    }

    if ((src == null) === (string == null)) {
      throw new Error('<RawScript /> requires exactly one of `src` (a file path) or `string` (inline content).');
    }

    if (string != null) {
      return string;
    }

    try {
      return readFileSync(src!, 'utf8');
    } catch (e) {
      throw new Error(`<RawScript /> could not read ${JSON.stringify(src)}: ${(e as Error).message}`, { cause: e });
    }
  });
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- inlines developer-authored file contents addressed by a working-dir path, never end-user input -->
{@html content}
