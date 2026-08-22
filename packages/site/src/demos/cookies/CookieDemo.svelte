<script lang="ts">
  import { isServer, isBrowser, cookies } from 'mochi-framework';

  let { defaultUsername = 'mochi_fan' } = $props();

  // svelte-ignore state_referenced_locally
  let username = $state(cookies.get('mochi_username') || defaultUsername);
  let theme = $state(cookies.get('mochi_theme') || 'auto');
  let message = $state('');

  // SSR snapshot — what the server saw in the request headers
  const ssrUsername = cookies.get('mochi_username') ?? '(not set)';
  const ssrTheme = cookies.get('mochi_theme') ?? '(not set)';

  async function setCookieViaApi() {
    if (!isBrowser) {
      return;
    }
    const res = await fetch('/api/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, theme }),
    });
    const json = (await res.json()) as { ok: boolean };
    if (json.ok) {
      message = 'Cookies set via API! Reload to see SSR pick them up.';
    }
  }

  function setCookieOnClient() {
    if (!isBrowser) {
      return;
    }
    cookies.set('mochi_username', username, { expires: 7, path: '/' });
    cookies.set('mochi_theme', theme, { expires: 7, path: '/' });
    message = 'Cookies set on client! Reload to see SSR pick them up.';
  }

  function clearCookies() {
    if (!isBrowser) {
      return;
    }
    cookies.delete('mochi_username', { path: '/' });
    cookies.delete('mochi_theme', { path: '/' });
    username = '';
    theme = 'light';
    message = 'Cookies cleared! Reload to confirm.';
  }
</script>

<div class="cookie-demo">
  <div class="section">
    <h3>SSR Read <span class="env">(server)</span></h3>
    <p class="desc">These values were read from the Cookie header during SSR:</p>
    <div class="values">
      <div class="val"><span class="label">mochi_username</span> <code>{ssrUsername}</code></div>
      <div class="val"><span class="label">mochi_theme</span> <code>{ssrTheme}</code></div>
    </div>
  </div>

  <div class="section">
    <h3>Client Read <span class="env">(browser)</span></h3>
    <p class="desc">
      Live values from <code>cookies.get()</code> on the {isServer ? 'server' : 'client'}:
    </p>
    <div class="values">
      <div class="val">
        <span class="label">mochi_username</span>
        <code>{cookies.get('mochi_username') ?? '(not set)'}</code>
      </div>
      <div class="val">
        <span class="label">mochi_theme</span>
        <code>{cookies.get('mochi_theme') ?? '(not set)'}</code>
      </div>
    </div>
  </div>

  <div class="section">
    <h3>Set Cookies</h3>
    <div class="form">
      <label>
        <span>Username</span>
        <input type="text" bind:value={username} placeholder="e.g. mochi_fan" />
      </label>
      <label>
        <span>Theme</span>
        <select bind:value={theme}>
          <option value="" disabled>(not set)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
      </label>
    </div>
    <div class="actions">
      <button onclick={setCookieOnClient}>Set via Client</button>
      <button onclick={setCookieViaApi}>Set via API</button>
      <button class="danger" onclick={clearCookies}>Clear</button>
    </div>
    {#if message}
      <p class="message">{message}</p>
    {/if}
  </div>
</div>

<style>
  .cookie-demo {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section h3 {
    font-size: 1.05rem;
    font-weight: 700;
    margin-bottom: 0.4rem;
    color: var(--text);
  }

  .env {
    font-weight: 400;
    color: var(--text-subtle);
    font-size: 0.85rem;
  }

  .desc {
    font-size: 0.95rem;
    color: var(--text-muted);
    margin-bottom: 0.6rem;
  }

  .desc code {
    background: var(--surface-muted);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    padding: 0.1em 0.35em;
    border-radius: 4px;
    font-size: 0.85em;
  }

  .values {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .val {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.95rem;
  }

  .val .label {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    color: var(--text-muted);
    min-width: 120px;
  }

  .val code {
    background: var(--code-bg);
    color: var(--code-accent);
    font-family: var(--font-mono);
    padding: 0.2rem 0.55rem;
    border-radius: 4px;
    font-size: 0.9rem;
  }

  .form {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }

  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .form input,
  .form select {
    padding: 0.45rem 0.65rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
    font-size: 0.95rem;
    outline: none;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }

  .form input:focus,
  .form select:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .actions button {
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text);
    font-family: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;
  }

  .actions button:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-soft-text);
  }

  .actions button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
  }

  .actions button.danger {
    color: var(--badge-danger-text);
    border-color: var(--border);
    background: var(--surface-muted);
  }

  .actions button.danger:hover {
    background: var(--badge-danger-bg);
    border-color: var(--badge-danger-text);
    color: var(--badge-danger-text);
  }

  .message {
    margin-top: 0.4rem;
    font-size: 0.95rem;
    color: var(--badge-success-text);
    font-weight: 500;
  }
</style>
