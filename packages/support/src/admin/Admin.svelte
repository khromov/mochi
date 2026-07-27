<script lang="ts">
  import '@fontsource/public-sans';
  import '@fontsource-variable/fraunces/full.css';
  import SubmissionCard from './SubmissionCard.svelte';
  import type { EmailLogEntry, Submission } from '../db.server';

  let {
    inbox,
    handled,
    logs,
    client,
  }: {
    inbox: Submission[];
    handled: Submission[];
    logs: Record<number, EmailLogEntry[]>;
    client: { address: string | null; forwardedFor: string | null };
  } = $props();
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

  <main class="body">
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
