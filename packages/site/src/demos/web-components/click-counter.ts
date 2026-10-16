// A plain custom element — no Svelte, no framework. Importing this module for
// its side effect registers <click-counter> with the browser's element registry.
class ClickCounter extends HTMLElement {
  #count = 0;

  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        button {
          font: inherit;
          padding: 0.4rem 0.8rem;
          border-radius: 6px;
          border: 1px solid #888;
          background: #f4f4f5;
          color: #18181b;
          cursor: pointer;
        }
        button:hover { background: #e4e4e7; }
      </style>
      <button type="button">Clicked 0 times</button>
    `;
    const button = shadow.querySelector('button')!;
    button.addEventListener('click', () => {
      this.#count++;
      button.textContent = `Clicked ${this.#count} times`;
    });
  }
}

// Guard against double-define: the island module can re-evaluate across HMR
// reloads, and customElements.define() throws on a duplicate name.
if (!customElements.get('click-counter')) {
  customElements.define('click-counter', ClickCounter);
}
