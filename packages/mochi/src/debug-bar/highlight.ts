const HIGHLIGHT_DURATION_MS = 1500;

let highlightOverlay: HTMLElement | null = null;
let highlightRafId: number = 0;

export function cleanupHighlight() {
  if (highlightRafId) {
    cancelAnimationFrame(highlightRafId);
    highlightRafId = 0;
  }
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

export function locateIsland(el: HTMLElement) {
  cleanupHighlight();

  const isContents = getComputedStyle(el).display === 'contents';
  const scrollTarget: HTMLElement = isContents && el.firstElementChild instanceof HTMLElement ? el.firstElementChild : el;

  const computeRect = (): DOMRect => {
    if (isContents && el.children.length > 0) {
      let top = Infinity,
        left = Infinity,
        bottom = -Infinity,
        right = -Infinity;
      for (const child of el.children) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) {
          continue;
        }
        top = Math.min(top, r.top);
        left = Math.min(left, r.left);
        bottom = Math.max(bottom, r.bottom);
        right = Math.max(right, r.right);
      }
      if (top !== Infinity) {
        return new DOMRect(left, top, right - left, bottom - top);
      }
    }
    return el.getBoundingClientRect();
  };

  const scrollPad = 40;
  const elTop = scrollTarget.getBoundingClientRect().top + window.scrollY - scrollPad;
  window.scrollTo({ top: Math.max(0, elTop), behavior: 'smooth' });

  const overlay = document.createElement('div');
  const pad = 2;
  overlay.style.cssText =
    'position:fixed;pointer-events:none;border:2px solid #8ab79a;border-radius:8px;z-index:99998;box-sizing:border-box;transition:opacity 300ms ease;opacity:1;box-shadow:0 0 0 4px rgba(138,183,154,0.18),0 0 24px rgba(138,183,154,0.35)';
  document.body.appendChild(overlay);
  highlightOverlay = overlay;

  const startTime = performance.now();
  const update = () => {
    const elapsed = performance.now() - startTime;
    if (elapsed >= HIGHLIGHT_DURATION_MS || !highlightOverlay) {
      cleanupHighlight();
      return;
    }
    const rect = computeRect();
    overlay.style.top = `${rect.top - pad}px`;
    overlay.style.left = `${rect.left - pad}px`;
    overlay.style.width = `${rect.width + pad * 2}px`;
    overlay.style.height = `${rect.height + pad * 2}px`;
    if (elapsed >= HIGHLIGHT_DURATION_MS - 300) {
      overlay.style.opacity = '0';
    }
    highlightRafId = requestAnimationFrame(update);
  };
  highlightRafId = requestAnimationFrame(update);
}
