<script lang="ts">
  import { isServer } from 'mochi-framework';
  import { delay } from './utils.ts';

  type ActivityEvent = {
    actor: string;
    action: string;
    target: string;
    minutesAgo: number;
    kind: 'order' | 'signup' | 'refund' | 'login';
  };

  // Simulate a slow database query when this server island is rendered.
  await (isServer ? delay(800, 1600) : Promise.resolve());

  const events: ActivityEvent[] = [
    { actor: 'amelia.k', action: 'placed order', target: '#48217', minutesAgo: 2, kind: 'order' },
    { actor: 'devon-r', action: 'signed up', target: 'free tier', minutesAgo: 5, kind: 'signup' },
    { actor: 'priya.n', action: 'refunded', target: '#48201', minutesAgo: 11, kind: 'refund' },
    { actor: 'admin', action: 'logged in', target: 'dashboard', minutesAgo: 14, kind: 'login' },
    { actor: 'leo.b', action: 'placed order', target: '#48198', minutesAgo: 19, kind: 'order' },
    { actor: 'sora-y', action: 'signed up', target: 'pro tier', minutesAgo: 24, kind: 'signup' },
  ];

  const fetchedAt = new Date().toLocaleTimeString('en-GB');
</script>

<div class="activity">
  <ul class="event-list">
    {#each events as ev (ev.actor + ev.target)}
      <li class="event">
        <span class="kind {ev.kind}" aria-hidden="true"></span>
        <div class="event-text">
          <span class="actor">{ev.actor}</span>
          <span class="action">{ev.action}</span>
          <span class="target">{ev.target}</span>
        </div>
        <span class="ago">{ev.minutesAgo}m ago</span>
      </li>
    {/each}
  </ul>
  <div class="meta">loaded from server at {fetchedAt}</div>
</div>

<style>
  .activity {
    background: var(--admin-surface-muted);
    border: 1px solid var(--admin-border);
    border-radius: var(--admin-radius-md);
    padding: 0.5rem 0.25rem 0.5rem;
  }

  .event-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .event {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.7rem;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid var(--admin-border);
  }

  .event:last-child {
    border-bottom: none;
  }

  .kind {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--admin-text-subtle);
  }

  .kind.order {
    background: var(--admin-badge-success-text);
  }

  .kind.signup {
    background: var(--admin-badge-info-text);
  }

  .kind.refund {
    background: var(--admin-badge-danger-text);
  }

  .kind.login {
    background: var(--admin-badge-warning-text);
  }

  .event-text {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.92rem;
    color: var(--admin-text);
    min-width: 0;
  }

  .actor {
    font-family: var(--admin-font-mono);
    color: var(--admin-accent);
    font-weight: 600;
  }

  .action {
    color: var(--admin-text-muted);
  }

  .target {
    font-family: var(--admin-font-mono);
    color: var(--admin-text);
  }

  .ago {
    font-size: 0.75rem;
    color: var(--admin-text-subtle);
    font-family: var(--admin-font-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .meta {
    padding: 0.4rem 0.85rem 0.1rem;
    font-size: 0.72rem;
    color: var(--admin-text-subtle);
    font-family: var(--admin-font-mono);
    text-align: right;
  }
</style>
