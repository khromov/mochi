<script lang="ts">
  import { isServer } from 'mochi-framework';
  import MochiBanner from '../hn/MochiBanner.svelte';

  type Todo = { id: string; text: string; done: boolean; createdAt: number };
  type Filter = 'all' | 'active' | 'done';

  const STORAGE_KEY = 'mochi-todo';

  let items = $state<Todo[]>([]);
  let draft = $state('');
  let filter = $state<Filter>('all');
  let dateLabel = $state('');
  let hydrated = $state(false);

  $effect(() => {
    hydrated = true;
    dateLabel = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          items = parsed.filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean');
        }
      }
    } catch {
      /* corrupt storage — start fresh */
    }
  });

  $effect(() => {
    if (!hydrated) {
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage blocked or full */
    }
  });

  const visible = $derived(filter === 'all' ? items : filter === 'active' ? items.filter((t) => !t.done) : items.filter((t) => t.done));
  const remaining = $derived(items.filter((t) => !t.done).length);
  const hasDone = $derived(items.some((t) => t.done));

  function add() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    items = [{ id: crypto.randomUUID(), text, done: false, createdAt: Date.now() }, ...items];
    draft = '';
  }

  function toggle(id: string) {
    items = items.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  }

  function remove(id: string) {
    items = items.filter((t) => t.id !== id);
  }

  function clearDone() {
    items = items.filter((t) => !t.done);
  }
</script>

<div class="mx-auto max-w-2xl px-3 sm:px-4">
  <MochiBanner />

  <div class="mx-auto flex max-w-md flex-col gap-6 pb-16 sm:max-w-lg md:max-w-xl">
    <header class="flex items-end justify-between gap-3 border-b border-stone-200 pb-4">
      <div class="flex flex-col gap-0.5">
        <h1 class="font-serif text-3xl font-medium tracking-tight text-stone-900 sm:text-4xl">Today</h1>
        <p class="text-sm text-stone-500">{isServer ? 'Loading…' : dateLabel}</p>
      </div>
      <span class="pb-1 text-xs tracking-wide text-stone-500 uppercase">
        {isServer ? 'Loading…' : `${remaining} left`}
      </span>
    </header>

    <form
      onsubmit={(e) => {
        e.preventDefault();
        add();
      }}
      class="flex items-center gap-2 rounded-lg border border-stone-200 bg-white p-1.5 transition focus-within:border-stone-900"
    >
      <input
        type="text"
        bind:value={draft}
        placeholder="Add a task…"
        aria-label="New todo"
        class="min-w-0 flex-1 px-2.5 py-1.5 text-[0.95rem] text-stone-900 placeholder:text-stone-400"
        autocomplete="off"
      />
      <button
        type="submit"
        aria-label="Add todo"
        disabled={!draft.trim()}
        class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-stone-900 text-white transition hover:bg-stone-700 disabled:bg-stone-200 disabled:text-stone-400"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>
    </form>

    <div class="flex items-center gap-5 text-xs tracking-wide text-stone-500 uppercase">
      {#each ['all', 'active', 'done'] as const as f (f)}
        <button
          type="button"
          onclick={() => (filter = f)}
          class="border-b border-transparent pb-0.5 transition hover:text-stone-900 {filter === f ? 'border-stone-900 text-stone-900' : ''}"
        >
          {f}
        </button>
      {/each}
    </div>

    <div class="rounded-lg border border-stone-200 bg-white">
      {#if visible.length === 0}
        <div class="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6 text-stone-300">
            <circle cx="12" cy="12" r="9" />
            <path d="m9 12 2 2 4-4" />
          </svg>
          <p class="text-sm text-stone-500">
            {#if isServer}
              Loading…
            {:else if items.length === 0}
              Nothing here yet. Add a task above.
            {:else if filter === 'active'}
              Nothing active.
            {:else}
              Nothing finished yet.
            {/if}
          </p>
        </div>
      {:else}
        <ul class="divide-y divide-stone-100">
          {#each visible as t (t.id)}
            <li class="group/item flex items-center gap-2 px-2 py-1.5 sm:px-3 sm:py-2">
              <button
                type="button"
                onclick={() => toggle(t.id)}
                aria-label={t.done ? `Mark "${t.text}" as not done` : `Mark "${t.text}" as done`}
                aria-pressed={t.done}
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md transition hover:bg-stone-50"
              >
                <span
                  class="grid h-[18px] w-[18px] place-items-center rounded-full border transition {t.done
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 text-transparent'}"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                </span>
              </button>

              <span class="min-w-0 flex-1 break-words text-[0.95rem] leading-snug transition {t.done ? 'text-stone-400 line-through decoration-stone-300' : 'text-stone-800'}">
                {t.text}
              </span>

              <button
                type="button"
                onclick={() => remove(t.id)}
                aria-label={`Delete "${t.text}"`}
                class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-stone-400 opacity-0 transition hover:bg-stone-50 hover:text-stone-700 group-hover/item:opacity-100 [@media(hover:none)]:opacity-100"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if items.length > 0}
        <div class="flex items-center justify-between gap-3 border-t border-stone-100 px-3 py-2 text-xs text-stone-500">
          <span>{items.length} {items.length === 1 ? 'task' : 'tasks'}</span>
          {#if hasDone}
            <button type="button" onclick={clearDone} class="text-stone-500 transition hover:text-stone-900"> Clear completed </button>
          {/if}
        </div>
      {/if}
    </div>

    <footer class="text-xs text-stone-400">
      Tailwind v4 via
      <code class="rounded bg-stone-100 px-1 py-0.5 font-mono text-[0.7rem] text-stone-600">mochi-framework/tailwind</code>. State persists to
      <code class="font-mono text-[0.7rem]">localStorage</code>.
    </footer>
  </div>
</div>
