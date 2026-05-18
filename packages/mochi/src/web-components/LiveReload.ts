class MochiLiveReload extends HTMLElement {
  private ws!: WebSocket;
  private navigating = false;
  private first = true;

  connectedCallback() {
    this.connect();
    addEventListener('pagehide', this.handlePageHide);
  }

  disconnectedCallback() {
    this.navigating = true;
    removeEventListener('pagehide', this.handlePageHide);
    try {
      this.ws.close(1000, 'disconnected');
    } catch {
      /* connection already closed */
    }
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
    this.ws = new WebSocket(proto + '//' + location.host + '/__mochi_live_reload' + query);
    window.__mochi_reload_ws = this.ws;

    this.ws.onopen = () => {
      if (!this.first) {
        location.reload();
      }
      this.first = false;
    };

    this.ws.onmessage = (e) => {
      if (e.data === 'reload') {
        this.navigating = true;
        try {
          this.ws.close(1000, 'navigating');
        } catch {
          /* connection already closed */
        }
        location.reload();
      }
    };

    this.ws.onclose = () => {
      if (!this.navigating) {
        setTimeout(() => this.connect(), 950);
      }
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  private handlePageHide = () => {
    this.navigating = true;
    try {
      this.ws.close(1000, 'navigating');
    } catch {
      /* connection already closed */
    }
  };
}

customElements.define('mochi-live-reload', MochiLiveReload);
