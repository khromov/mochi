<script lang="ts">
  import { readFileSync } from 'node:fs';

  let {
    src,
    string,
    isHydratable,
  }: {
    src?: string;
    string?: string;
    isHydratable?: boolean;
  } = $props();

  if (isHydratable) {
    throw new Error('<RawScript /> must not be hydrated — it inlines file contents during SSR only. Remove the mochi: directives.');
  }

  if ((src == null) === (string == null)) {
    throw new Error('<RawScript /> requires exactly one of `src` (a file path) or `string` (inline content).');
  }

  let content: string;
  if (string != null) {
    content = string;
  } else {
    try {
      content = readFileSync(src!, 'utf8');
    } catch (e) {
      throw new Error(`<RawScript /> could not read ${JSON.stringify(src)}: ${(e as Error).message}`, { cause: e });
    }
  }
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- inlines developer-authored file contents addressed by a working-dir path, never end-user input -->
{@html content}
