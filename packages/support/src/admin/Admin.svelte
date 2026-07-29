<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import SubmissionCard from './SubmissionCard.svelte';
  import NewsletterPanel from './NewsletterPanel.svelte';
  import type { EmailLogEntry, NewsletterLogEntry, Submission, Subscriber } from '../db.server';

  let {
    inbox,
    handled,
    logs,
    subscribers,
    newsletterLogs,
    tab,
    client,
  }: {
    inbox: Submission[];
    handled: Submission[];
    logs: Record<number, EmailLogEntry[]>;
    subscribers: Subscriber[];
    newsletterLogs: Record<number, NewsletterLogEntry[]>;
    tab: 'support' | 'newsletter';
    client: { address: string | null; forwardedFor: string | null };
  } = $props();

  // Confirmed only — a signup that never clicked the link isn't a subscriber.
  const confirmed = $derived(subscribers.filter((s) => s.status === 'confirmed').length);
</script>

<svelte:head>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Support inbox — Mochi</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header class="hero-minimal">
    <a class="back" href="/">← Support form</a>
    <div class="hero-inner">
      <a class="logo" href="/admin/">🍡 support inbox</a>
    </div>
  </header>

  <nav class="tabs" aria-label="Admin sections">
    <a class="tab" href="/admin/" aria-current={tab === 'support' ? 'page' : undefined}>
      Support requests
      <span class="badge" class:zero={inbox.length === 0}>{inbox.length}</span>
    </a>
    <a class="tab" href="/admin/?tab=newsletter" aria-current={tab === 'newsletter' ? 'page' : undefined}>
      Newsletter
      <span class="badge" class:zero={confirmed === 0}>{confirmed}</span>
    </a>
  </nav>

  <main class="body">
    {#if tab === 'newsletter'}
      <NewsletterPanel {subscribers} logs={newsletterLogs} />
    {:else}
      <section>
        <h2>Inbox <span class="count">{inbox.length}</span></h2>
        {#if inbox.length === 0}
          <p class="empty">Nothing waiting. New submissions land here.</p>
        {:else}
          <div class="list">
            {#each inbox as submission (submission.id)}
              <SubmissionCard {submission} log={logs[submission.id] ?? []} />
            {/each}
          </div>
        {/if}
      </section>

      <section>
        <h2>Handled <span class="count">{handled.length}</span></h2>
        {#if handled.length === 0}
          <p class="empty">Nothing handled yet.</p>
        {:else}
          <div class="list">
            {#each handled as submission (submission.id)}
              <SubmissionCard {submission} log={logs[submission.id] ?? []} />
            {/each}
          </div>
        {/if}
      </section>
    {/if}

    <footer class="client">
      Your IP: <code>{client.address ?? 'unknown'}</code>
      · X-Forwarded-For: <code>{client.forwardedFor ?? '(none)'}</code>
    </footer>
  </main>
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .hero-minimal {
    padding: 1.5rem;
  }

  .back {
    position: absolute;
    top: 1rem;
    left: 1rem;
    padding: 0.35rem 0.7rem;
    font-size: 0.85rem;
    font-weight: 500;
    color: #d8e4dc;
    text-decoration: none;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: var(--radius-md);
  }

  .back:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
  }

  .hero-inner {
    position: relative;
    max-width: 720px;
    margin: 0 auto;
  }

  .logo {
    font-family: var(--font-serif);
    font-size: 2.5rem;
    font-weight: 400;
    font-variation-settings:
      'opsz' 144,
      'SOFT' 50;
    color: #fff;
    letter-spacing: -0.015em;
    text-decoration: none;
  }

  .tabs {
    display: flex;
    gap: 0.5rem;
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 1rem 1.5rem 0;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
  }

  .tab:hover {
    background: var(--surface);
    color: var(--text);
  }

  .tab[aria-current='page'] {
    background: var(--surface);
    border-color: var(--accent);
    color: var(--text);
  }

  .badge {
    min-width: 1.5rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    font-size: 0.75rem;
    font-weight: 700;
    text-align: center;
  }

  .badge.zero {
    background: var(--surface-muted);
    color: var(--text-subtle);
    border: 1px solid var(--border);
  }

  .body {
    max-width: 720px;
    width: 100%;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    flex: 1;
  }

  h2 {
    font-family: var(--font-serif);
    font-size: 1.5rem;
    font-weight: 500;
    margin: 2rem 0 1rem;
  }

  .body section:first-child h2 {
    margin-top: 0;
  }

  .count {
    display: inline-block;
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-soft-text);
    vertical-align: middle;
  }

  .empty {
    color: var(--text-subtle);
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .client {
    margin-top: 2.5rem;
    font-size: 0.8rem;
    color: var(--text-subtle);
  }

  .client code {
    font-size: 0.8rem;
  }

  @media (max-width: 768px) {
    .back {
      position: static;
      display: inline-block;
      margin-bottom: 0.75rem;
    }
  }
</style>
