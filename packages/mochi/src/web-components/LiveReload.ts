type LiveReloadStatus = 'connected' | 'reconnecting' | 'disconnected';

const HEARTBEAT_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 20_000;
const MAX_BACKOFF_MS = 3000;

class MochiLiveReload extends HTMLElement {
  private ws: WebSocket | null = null;
  /** Set only when the page is truly going away — the one state that stops the retry loop. */
  private closedForGood = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private backoff = 0;
  private lastMessageAt = 0;
  private bootId: string | null = null;

  connectedCallback() {
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
    // window.__mochi_page_entry is the abs path of the entry that rendered
    // this page, injected by the shell renderer in dev. Sending it lets the
    // server scope `reload` signals to the tabs whose entry was actually
    // recompiled. Tabs loaded against an older shell omit it and conserva-
    // tively reload on every change.
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
        const id = e.data.slice('boot:'.length);
        if (this.bootId === null) {
          this.bootId = id;
        } else if (this.bootId !== id) {
          // The dev server restarted while we were disconnected, so this page
          // may be rendered from stale code.
          this.reloadNow();
        }
        return;
      }
      // A dev-outbox email landed (message is `email:new:<id>`). On the outbox page
      // itself, full-reload so the new message shows up live; anywhere else, hand the
      // captured id to the debug bar so it can mark it unread. assetPrefix is only
      // injected with the debug bar, which is also what mounts the outbox route — so
      // it's present whenever it matters.
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
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws) {
        return;
      }
      if (ws.readyState !== WebSocket.OPEN || Date.now() - this.lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
        this.dropSocket();
        this.scheduleReconnect(0);
        return;
      }
      try {
        ws.send('ping');
      } catch {
        this.dropSocket();
        this.scheduleReconnect(0);
      }
    }, HEARTBEAT_MS);
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

  // `pagehide` also fires when the page enters the back/forward cache, where the
  // element is never re-created — so release the socket but leave the retry loop
  // armed for `pageshow` to restart. Treating this as terminal is what used to
  // leave a restored tab permanently disconnected.
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
    if (this.ws === null || this.ws.readyState > WebSocket.OPEN) {
      this.backoff = 0;
      this.clearRetry();
      this.connect();
    }
  };
}

customElements.define('mochi-live-reload', MochiLiveReload);
