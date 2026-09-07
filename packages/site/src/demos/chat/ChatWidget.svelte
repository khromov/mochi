<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  const GREETING = { text: 'Hello friend! How are you?', fromMe: false };

  let messages: Array<{ text: string; fromMe: boolean }> = $state([GREETING]);
  let input = $state('');
  let messagesEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    void messages.length;
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });

  let chatSocket: WebSocket | null = null;
  let disconnected = $state<string | null>(null);
  let reconnecting = $state(false);
  let userId = '';

  // The server states its reason for these; anything else is a transport drop worth retrying.
  const POLICY_CLOSE_CODES = new Set([1003, 1008, 1009]);
  const MAX_RECONNECT_ATTEMPTS = 5;

  if (isBrowser) {
    userId =
      localStorage.getItem('chatUserId') ??
      (() => {
        const id = crypto.randomUUID();
        localStorage.setItem('chatUserId', id);
        return id;
      })();

    const host = window.location.host;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let attempts = 0;

    const connect = () => {
      const socket = new WebSocket(`${wsProtocol}//${host}/ws/chat`);
      chatSocket = socket;

      socket.addEventListener('open', () => {
        attempts = 0;
        reconnecting = false;
        disconnected = null;
        // The server replays its whole history on every connection, so a reconnect would otherwise double every message.
        messages = [GREETING];
      });

      socket.addEventListener('message', (e) => {
        const msg = JSON.parse(e.data);
        messages = [...messages, { text: msg.text, fromMe: msg.userId === userId }];
      });

      // send() on a closed socket is a silent no-op, so without this the box would keep accepting text into the void.
      socket.addEventListener('close', (e) => {
        if (POLICY_CLOSE_CODES.has(e.code)) {
          disconnected = e.reason || (e.code === 1009 ? 'Message too large' : 'Connection closed');
          return;
        }
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          reconnecting = false;
          disconnected = 'Connection closed';
          return;
        }
        reconnecting = true;
        setTimeout(connect, 500 * 2 ** attempts++);
      });
    };

    connect();
  }

  function send() {
    const text = input.trim();
    if (!text || !chatSocket || chatSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    chatSocket.send(JSON.stringify({ userId, text }));
    input = '';
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      send();
    }
  }
</script>

<div class="chat-container">
  <div class="chat-header">
    <span class="chat-title">Chat</span>
  </div>

  <div class="chat-messages" bind:this={messagesEl}>
    {#each messages as msg, i (i)}
      <div class="message" class:mine={msg.fromMe}>
        <span class="bubble">{msg.text}</span>
      </div>
    {/each}
    {#if messages.length === 0}
      <div class="empty">Send a message to get started</div>
    {/if}
  </div>

  {#if disconnected}
    <p class="disconnected" role="alert">{disconnected} — reload the page to reconnect.</p>
  {:else if reconnecting}
    <p class="disconnected" role="status">Reconnecting…</p>
  {/if}

  <div class="chat-input">
    <input type="text" bind:value={input} onkeydown={onKeydown} placeholder="Type a message..." disabled={!!disconnected || reconnecting} />
    <button onclick={send} disabled={!!disconnected || reconnecting}>Send</button>
  </div>
</div>

<style>
  .chat-container {
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 400px;
    height: 500px;
    margin: 0 auto;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
    box-shadow: var(--shadow-md);
  }

  .chat-header {
    padding: 1rem 1.25rem;
    background: var(--code-chrome-bg);
    color: var(--code-text);
  }

  .chat-title {
    font-weight: 600;
    font-size: 1rem;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--surface-muted);
  }

  .message {
    display: flex;
  }

  .message.mine {
    justify-content: flex-end;
  }

  .bubble {
    padding: 0.5rem 0.85rem;
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    font-size: 0.95rem;
    max-width: 75%;
    word-break: break-word;
  }

  .message.mine .bubble {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }

  .empty {
    margin: auto;
    color: var(--text-subtle);
    font-style: italic;
    font-size: 0.95rem;
  }

  .disconnected {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
    color: var(--error, #b91c1c);
    font-size: 0.85rem;
  }

  .chat-input {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }

  .chat-input input {
    flex: 1;
    padding: 0.5rem 0.75rem;
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

  .chat-input input:focus {
    border-color: var(--accent);
    box-shadow: var(--focus-ring);
  }

  .chat-input button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-text);
    border: none;
    border-radius: var(--radius-sm);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s ease;
  }

  .chat-input button:hover {
    background: var(--accent-hover);
  }

  .chat-input input:disabled,
  .chat-input button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
