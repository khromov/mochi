<script>
  import './app.generated.css';
  import DemoPage from '../../components/DemoPage.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Tailwind.svelte', path: './src/demos/tailwind/Tailwind.svelte' },
    { label: 'app.css', path: './src/demos/tailwind/app.css' },
    { label: 'routes.ts', path: './src/demos/tailwind/routes.ts' },
    { label: 'tailwind.ts (mochi-framework/tailwind)', path: '../mochi/src/tailwind.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  const palette = [
    { name: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-600/20' },
    { name: 'sky', bg: 'bg-sky-500', ring: 'ring-sky-600/20' },
    { name: 'violet', bg: 'bg-violet-500', ring: 'ring-violet-600/20' },
    { name: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-600/20' },
    { name: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-600/20' },
    { name: 'slate', bg: 'bg-slate-500', ring: 'ring-slate-600/20' },
  ];
</script>

<DemoPage
  title="Tailwind"
  description="You can use Tailwind v4 driven directly by its Node API — no PostCSS, no Vite. The integration runs at startup, scans the demo's sources for class candidates, writes a generated CSS file, and lets Mochi's side-effect CSS bundler link it scoped to this page."
  {sources}
>
  <div class="stack">
    <!-- Hero card -->
    <div
      class="overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white to-slate-50 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:to-slate-950"
    >
      <div class="p-7 sm:p-8">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3 class="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Tailwind v4, no PostCSS</h3>
            <p class="mt-2 max-w-prose text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Compiled by
              <code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">@tailwindcss/node</code>
              at server startup, scanned by
              <code class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">@tailwindcss/oxide</code>, served as a hashed
              stylesheet linked only on this page.
            </p>
          </div>
          <span
            class="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30"
          >
            v4.2
          </span>
        </div>

        <div class="mt-7 flex flex-wrap items-center gap-3">
          <button
            class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-600/25 transition hover:bg-emerald-700 hover:shadow-emerald-600/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            Primary action
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Secondary
          </button>
          <button
            class="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Ghost
          </button>
        </div>
      </div>

      <div class="border-t border-slate-200/80 bg-slate-50/60 px-7 py-4 sm:px-8 dark:border-slate-800 dark:bg-slate-950/60">
        <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30"></span>
          Scoped to <code class="font-mono">/demos/tailwind</code> only
        </div>
      </div>
    </div>

    <!-- Palette swatches -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {#each palette as swatch (swatch.name)}
        <div
          class="group flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 transition hover:-translate-y-0.5 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <span class="h-12 w-full rounded-md ring-1 {swatch.bg} {swatch.ring}"></span>
          <span class="font-mono text-xs text-slate-600 dark:text-slate-400">{swatch.name}-500</span>
        </div>
      {/each}
    </div>
  </div>
</DemoPage>

<style>
  .stack {
    display: grid;
    gap: 1.25rem;
    margin-top: 0.5rem;
  }
</style>
