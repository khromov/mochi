type LiveReloadStatus = 'connected' | 'reconnecting' | 'disconnected';

const HEARTBEAT_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 20_000;
const MAX_BACKOFF_MS = 3000;

/** `<uuid>:<generation>` — the uuid itself contains no colon. */
function splitGreeting(payload: string): [string, number] {
  const sep = payload.lastIndexOf(':');
  if (sep === -1) {
    return [payload, 0];
  }
  const gen = Number.parseInt(payload.slice(sep + 1), 10);
  return [payload.slice(0, sep), Number.isNaN(gen) ? 0 : gen];
}

class MochiLiveReload extends HTMLElement {
  private ws: WebSocket | null = null;
  /** Set only when the page is truly going away — the one state that stops the retry loop. */
  private closedForGood = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private lastMessageAt = 0;
  private lastTickAt = 0;
  private bootId: string | null = null;
  private reloadGeneration = 0;

  connectedCallback() {
    // A custom element is disconnected and reconnected whenever it's moved in
    // the DOM; without this reset, that would retire live reload for good.
    this.closedForGood = false;
    this.connect();
    addEventListener('pagehide', this.handlePageHide);
    addEventListener('pageshow', this.handlePageShow);
    addEventListener('online', this.handleWake);
    document.addEventListener('visibilitychange', this.handleWake);
  }

  disconnectedCallback() {
    this.closedForGood = true;
    this.teardown();
    removeEventListener('pagehide', this.handlePageHide);
    removeEventListener('pageshow', this.handlePageShow);
    removeEventListener('online', this.handleWake);
    document.removeEventListener('visibilitychange', this.handleWake);
  }

  private setStatus(status: LiveReloadStatus) {
    if (window.__mochi_live_reload_status === status) {
      return;
    }
    window.__mochi_live_reload_status = status;
    // The debug bar's status dot mounts and unmounts independently of this
    // element and outlives individual sockets, so it subscribes to this event
    // rather than to a WebSocket instance that every reconnect replaces.
    dispatchEvent(new CustomEvent('mochi:live-reload-status', { detail: { status } }));
  }

  private connect() {
    if (this.closedForGood) {
      return;
    }
    this.clearRetry();
    this.dropSocket();

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // `window.__mochi_page_entry` is the absolute path of the entry that rendered this page, injected by the dev shell
    // renderer, so sending it lets the server scope `reload` signals to tabs whose entry actually recompiled. A tab
    // loaded against an older shell omits it and conservatively reloads on every change.
    const entry = window.__mochi_page_entry;
    const query = entry ? '?entry=' + encodeURIComponent(entry) : '';

    let ws: WebSocket;
    try {
      ws = new WebSocket(proto + '//' + location.host + '/__mochi_live_reload' + query);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    window.__mochi_reload_ws = ws;
    this.setStatus('reconnecting');

    ws.onopen = () => {
      this.backoff = 0;
      this.lastMessageAt = Date.now();
      this.setStatus('connected');
      this.startHeartbeat();
    };

    ws.onmessage = (e) => {
      this.lastMessageAt = Date.now();
      if (typeof e.data !== 'string') {
        return;
      }
      if (e.data === 'reload') {
        this.reloadNow();
        return;
      }
      if (e.data.startsWith('boot:')) {
        // `boot:<process id>:<reload generation>`: the id moves when the dev server restarts, the generation when a
        // reload was broadcast for this page's entry. Either means the page may be rendered from stale code; with
        // neither, the socket merely blipped and the page state is still worth keeping.
        const [id, gen] = splitGreeting(e.data.slice('boot:'.length));
        if (this.bootId === null) {
          this.bootId = id;
          this.reloadGeneration = gen;
        } else if (this.bootId !== id || gen > this.reloadGeneration) {
          this.reloadNow();
        }
        return;
      }
      // A dev-outbox email landed. The outbox page full-reloads so the message shows up live; anywhere else the
      // captured id goes to the debug bar to mark it unread. `assetPrefix` ships with the debug bar, which also mounts
      // the outbox route, so it's present whenever it matters.
      if (e.data.startsWith('email:new:')) {
        const id = e.data.slice('email:new:'.length);
        const prefix = window.__mochi_asset_prefix;
        const onOutbox = typeof prefix === 'string' && location.pathname.replace(/\/+$/, '') === `${prefix}/email`;
        if (onOutbox) {
          this.reloadNow();
        } else {
          dispatchEvent(new CustomEvent('mochi:email-new', { detail: { id } }));
        }
      }
    };

    ws.onclose = () => {
      if (ws !== this.ws) {
        return;
      }
      this.stopHeartbeat();
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      if (ws === this.ws) {
        ws.close();
      }
    };
  }

  private scheduleReconnect(delay = this.nextBackoff()) {
    if (this.closedForGood || this.retryTimer !== null) {
      return;
    }
    this.setStatus(delay === 0 ? 'reconnecting' : 'disconnected');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  /** Retry instantly on the first failure, then back off — an editing loop should never wait. */
  private nextBackoff() {
    const delay = this.backoff;
    this.backoff = delay === 0 ? 250 : Math.min(delay * 2, MAX_BACKOFF_MS);
    return delay;
  }

  private clearRetry() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // A socket whose TCP connection died without a close frame (sleep, wifi
  // switch, silent proxy drop) stays readyState OPEN forever, so nothing else
  // would ever trigger a reconnect. Ping and require any inbound traffic back.
  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastTickAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) {
        return;
      }
      const now = Date.now();
      const sinceTick = now - this.lastTickAt;
      this.lastTickAt = now;
      if (ws.readyState !== WebSocket.OPEN) {
        this.dropSocket();
        this.scheduleReconnect(0);
        return;
      }
      // Background tabs throttle timers to roughly one tick a minute and a sleeping machine stops them entirely, so a
      // long gap since the last tick says nothing about the socket — it's silence the server never had a chance to
      // break. Re-arming the budget and judging on the next tick avoids recycling a healthy socket every hidden minute.
      if (sinceTick > HEARTBEAT_MS * 1.5) {
        this.lastMessageAt = now;
      } else if (now - this.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        this.dropSocket();
        this.scheduleReconnect(0);
        return;
      }
      this.ping(ws);
    }, HEARTBEAT_MS);
  }

  private ping(ws: WebSocket) {
    try {
      ws.send('ping');
    } catch {
      this.dropSocket();
      this.scheduleReconnect(0);
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Detach and close the current socket so its late events can't re-enter the loop. */
  private dropSocket(code = 1000, reason = 'replaced') {
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    if (!ws) {
      return;
    }
    if (window.__mochi_reload_ws === ws) {
      // Leaving the global pointing at a closed socket makes anything that
      // reads it (the debug bar's mount-time fallback) report stale state.
      window.__mochi_reload_ws = undefined;
    }
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(code, reason);
    } catch {
      /* connection already closed */
    }
  }

  private teardown() {
    this.clearRetry();
    this.dropSocket(1000, 'navigating');
  }

  private reloadNow() {
    this.closedForGood = true;
    this.teardown();
    location.reload();
  }

  // `pagehide` also fires when the page enters the back/forward cache, where the element is never re-created, so the
  // socket is released while the retry loop stays armed for `pageshow`. Treating it as terminal used to leave a
  // restored tab permanently disconnected.
  private handlePageHide = () => {
    this.clearRetry();
    this.dropSocket(1000, 'hidden');
    this.setStatus('disconnected');
  };

  private handlePageShow = () => {
    this.backoff = 0;
    if (!this.closedForGood && this.ws === null) {
      this.connect();
    }
  };

  private handleWake = () => {
    if (this.closedForGood || document.visibilityState === 'hidden') {
      return;
    }
    const ws = this.ws;
    if (ws === null || ws.readyState > WebSocket.OPEN) {
      this.backoff = 0;
      this.clearRetry();
      this.connect();
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      // The socket claims to be open, but timers were throttled or frozen
      // while we were away, so its silence budget means nothing. Restart the
      // clock and ping now: if it died out there, the next tick catches it.
      this.lastMessageAt = Date.now();
      this.startHeartbeat();
      this.ping(ws);
    }
  };
}

customElements.define('mochi-live-reload', MochiLiveReload);
