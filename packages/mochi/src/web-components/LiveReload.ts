import { logger } from '../log';

class MochiLiveReload extends HTMLElement {
  private ws!: WebSocket;
  private navigating = false;
  private first = true;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  connectedCallback() {
    this.connect();
    addEventListener('pagehide', this.handlePageHide);
  }

  disconnectedCallback() {
    this.navigating = true;
    removeEventListener('pagehide', this.handlePageHide);
    this.clearTimers();
    try {
      this.ws.close(1000, 'disconnected');
    } catch {
      /* connection already closed */
    }
  }

  private clearTimers() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.reconnectTimer);
  }

  private connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // window.__mochi_page_entry is the abs path of the entry that rendered
    // this page, injected by resolveHtmlShell in dev. Sending it lets the
    // server scope `reload` signals to the tabs whose entry was actually
    // recompiled. Tabs loaded against an older shell omit it and conserva-
    // tively reload on every change.
    const entry = window.__mochi_page_entry;
    const query = entry ? '?entry=' + encodeURIComponent(entry) : '';
    const ws = new WebSocket(proto + '//' + location.host + '/__mochi_live_reload' + query);
    this.ws = ws;
    window.__mochi_reload_ws = ws;

    // A CONNECTING socket against a down/unreachable server can hang for the
    // browser's full TCP timeout without ever firing close/error, which stalls
    // the reconnect loop. Force it closed after 2s so onclose schedules a retry.
    this.connectTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch {
          /* already closed */
        }
      }
    }, 2000);

    ws.onopen = () => {
      clearTimeout(this.connectTimer);
      this.broadcast('connected');
      if (!this.first) {
        location.reload();
      }
      this.first = false;
    };

    ws.onmessage = (e) => {
      if (e.data === 'reload') {
        this.navigating = true;
        this.clearTimers();
        try {
          ws.close(1000, 'navigating');
        } catch {
          /* connection already closed */
        }
        location.reload();
      }
    };

    ws.onclose = () => {
      clearTimeout(this.connectTimer);
      this.broadcast('disconnected');
      if (!this.navigating) {
        logger.warn('live reload disconnected — retrying in 950ms');
        this.reconnectTimer = setTimeout(() => this.connect(), 950);
      }
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
  }

  // Broadcast on window (not on a single socket instance) so the debug bar's
  // status dot follows the live connection across reconnects.
  private broadcast(status: 'connected' | 'disconnected') {
    dispatchEvent(new CustomEvent('mochi:reload-status', { detail: status }));
  }

  private handlePageHide = () => {
    this.navigating = true;
    this.clearTimers();
    try {
      this.ws.close(1000, 'navigating');
    } catch {
      /* connection already closed */
    }
  };
}

customElements.define('mochi-live-reload', MochiLiveReload);
