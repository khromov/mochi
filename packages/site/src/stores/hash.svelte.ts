let hash = $state(typeof window !== 'undefined' ? window.location.hash : '');
let pathname = $state(typeof window !== 'undefined' ? window.location.pathname : '');

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    hash = window.location.hash;
  });
  window.addEventListener('popstate', () => {
    pathname = window.location.pathname;
  });
}

export function getLocationHash(): string {
  return hash;
}

export function getLocationPathname(): string {
  return pathname;
}
