/**
 * Build the inline `<script type="module">` markup that dynamically imports each
 * bundled URL. Lives in a plain `.ts` module (not the `.svelte` file) because a
 * literal `<script>` / `</script>` in a Svelte `<script>` block breaks Svelte's
 * script-tag extraction.
 */
export function buildScriptModuleTag(urls: string[]): string {
  const imports = urls.map((u) => `import(${JSON.stringify(u)});`).join('');
  return `<script type="module">${imports}</script>`;
}
