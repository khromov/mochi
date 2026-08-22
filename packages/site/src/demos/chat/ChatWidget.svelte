<script lang="ts">
  import { isBrowser } from 'mochi-framework';

  let messages: Array<{ text: string; fromMe: boolean }> = $state([{ text: 'Hello friend! How are you?', fromMe: false }]);
  let input = $state('');
  let messagesEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    void messages.length;
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  });

  let chatSocket: WebSocket | null = null;
  let userId = '';

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

    chatSocket = new WebSocket(`${wsProtocol}//${host}/ws/chat`);
    chatSocket.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      messages = [...messages, { text: msg.text, fromMe: msg.userId === userId }];
    });
  }

  function send() {
    const text = input.trim();
    if (!text || !chatSocket) {
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

  <div class="chat-input">
    <input type="text" bind:value={input} onkeydown={onKeydown} placeholder="Type a message..." />
    <button onclick={send}>Send</button>
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
</style>
