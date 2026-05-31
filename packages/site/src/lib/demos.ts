export type DemoCategory = 'hydration' | 'data' | 'realtime' | 'forms' | 'errors' | 'sites';

export interface Demo {
  href: string;
  title: string;
  hook: string;
  category: DemoCategory;
}

export const categoryLabels: Record<DemoCategory, string> = {
  hydration: 'Basic',
  data: 'Data & serialization',
  realtime: 'Realtime and APIs',
  forms: 'Forms',
  errors: 'Errors',
  sites: 'Demo sites',
};

export const categoryOrder: DemoCategory[] = ['hydration', 'data', 'realtime', 'forms', 'errors', 'sites'];

export const demos: Demo[] = [
  {
    href: '/demos/hello-world/',
    title: 'Hello World',
    hook: 'The simplest possible Mochi page — pure server-rendered Svelte.',
    category: 'hydration',
  },
  {
    href: '/demos/server-props/',
    title: 'Server Props',
    hook: 'Define serverProps on Mochi.page() to pass fresh data into a Svelte page on every request.',
    category: 'data',
  },
  {
    href: '/demos/hydration/',
    title: 'Hydration Modes',
    hook: 'The same component rendered five ways — eager, lazy, visible, rootMargin-tuned, and deferred server island.',
    category: 'hydration',
  },
  {
    href: '/demos/data-loading/',
    title: 'Data Loading',
    hook: 'Server-side fetch from PokéAPI cached via MochiCache and rendered at request time.',
    category: 'data',
  },
  {
    href: '/demos/hydratable/',
    title: 'Hydratable',
    hook: 'Compute a value once on the server with hydratable(); the hydrated island reads it from <head> instead of re-running the async work.',
    category: 'data',
  },
  {
    href: '/demos/cookies/',
    title: 'Cookies',
    hook: 'Read and write cookies on the server and the client through one MochiCookieJar API.',
    category: 'data',
  },
  {
    href: '/demos/url/',
    title: 'Isomorphic URL',
    hook: 'One import for the current URL — reads from the request on the server, window.location on the client.',
    category: 'data',
  },
  {
    href: '/demos/cache-events/',
    title: 'Cache Events',
    hook: 'Subscribe to MochiCache lifecycle events through mochiEvents and log them to the server console.',
    category: 'data',
  },
  {
    href: '/demos/image/',
    title: 'Image Resizing',
    hook: 'On-the-fly image resizing on Bun.Image, served from a signed, stale-while-revalidate disk cache.',
    category: 'data',
  },
  {
    href: '/demos/image-pipeline/',
    title: 'Advanced Image use',
    hook: 'Decode, resize, rotate, flip, modulate, and re-encode with the raw Bun.Image pipeline — every option, server-rendered to inline data URLs.',
    category: 'data',
  },
  {
    href: '/cookie-vary-test/',
    title: 'Cookie Vary Test',
    hook: 'A page that sets Vary: Cookie on its response — useful for testing cookie-partitioned cache keys.',
    category: 'data',
  },
  {
    href: '/demos/chat/',
    title: 'Real-time Chat',
    hook: 'A hydrated island over a Mochi.ws() route, with pub/sub broadcast and in-memory history.',
    category: 'realtime',
  },
  {
    href: '/demos/api/',
    title: 'API Endpoints',
    hook: 'JSON routes defined with Mochi.api(), tested live against the running server.',
    category: 'realtime',
  },
  {
    href: '/demos/shared-state/',
    title: 'Shared State',
    hook: 'Two separate islands sharing the same reactive $state.',
    category: 'hydration',
  },
  {
    href: '/demos/streams/',
    title: 'Real-time Streams',
    hook: 'WebSocket and SSE clocks, lazily hydrated via mochi:hydrate:visible.',
    category: 'realtime',
  },
  {
    href: '/demos/server-island/',
    title: 'Server Islands',
    hook: 'Components marked mochi:defer render server-side on demand after the initial page is delivered.',
    category: 'hydration',
  },
  {
    href: '/demos/island-props/',
    title: 'Crossing the server-client boundary with props',
    hook: 'How props travel from a server-rendered parent into a hydrated island — Date, Map, Set, BigInt, URL, typed arrays, and even cyclic refs survive devalue’s round-trip.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy/',
    title: 'Lazy Islands',
    hook: 'Islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy-server-island/',
    title: 'Lazy Server Islands',
    hook: 'Server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view.',
    category: 'hydration',
  },
  {
    href: '/demos/font-loading/',
    title: 'Font loading',
    hook: 'Ship fonts via @fontsource packages or standalone .woff2 files — automatically bundled and linked from the page head.',
    category: 'hydration',
  },
  {
    href: '/demos/mdsvex/',
    title: 'MdSvex',
    hook: 'A .md file compiled through mdsvex and rendered as a Svelte component, with an embedded <script> block.',
    category: 'hydration',
  },
  {
    href: '/demos/nested-components/',
    title: 'Nested Components',
    hook: 'A five-level recursive tree — hydrating the root carries the whole subtree in one island.',
    category: 'hydration',
  },
  {
    href: '/demos/prop-dedup/',
    title: 'Shared Props',
    hook: 'Nine islands, three unique payloads — each set serialized once and referenced via props-ref.',
    category: 'hydration',
  },
  {
    href: '/demos/login/',
    title: 'Form Actions',
    hook: 'A login form rendered twice — plain HTML POST and intercepted with {@attach enhance(...)}.',
    category: 'forms',
  },
  {
    href: '/demos/form-return-data/',
    title: 'Using form return data',
    hook: 'An action returns data via success({...}); {@attach enhance(...)} updates the UI in place, plain HTML re-renders the page.',
    category: 'forms',
  },
  {
    href: '/demos/form-errors/',
    title: 'Form Errors',
    hook: 'A thrown action error shown inline via {@attach enhance(...)}, or as the Mochi error page on plain submit.',
    category: 'forms',
  },
  {
    href: '/demos/form-redirects/',
    title: 'Form Redirects',
    hook: 'redirect(303, …) intercepted as a JSON envelope by {@attach enhance(...)}, or followed natively by the browser.',
    category: 'forms',
  },
  {
    href: '/demos/file-upload/',
    title: 'File Uploads via form actions',
    hook: 'multipart/form-data submission, validated with fail() and success(), shown enhanced and plain.',
    category: 'forms',
  },
  {
    href: '/demos/reload-form-data/',
    title: 'Reloading associated form data',
    hook: 'After a successful submit, refetch the related list inside enhance() — or rely on the post-POST re-render.',
    category: 'forms',
  },
  {
    href: '/demos/form-cancel/',
    title: 'Cancelling form submissions',
    hook: 'cancel() prevents the fetch from firing; controller.abort() stops one mid-flight.',
    category: 'forms',
  },
  {
    href: '/demos/error/',
    title: 'Error Handling',
    hook: 'Catch render errors and unmatched routes via Mochi.serve()’s errorPage option and the handleError hook.',
    category: 'errors',
  },
  {
    href: '/demos/error-boundaries/',
    title: 'Error Boundaries',
    hook: 'Contain island failures with <svelte:boundary> so one broken component does not crash the page.',
    category: 'errors',
  },
  {
    href: 'https://demos.mochi.fast/hn',
    title: 'Hacker News Clone',
    hook: 'A full Hacker News reader built on Mochi — SSR pages, hydrated islands, real API.',
    category: 'sites',
  },
  {
    href: 'https://demos.mochi.fast/admin',
    title: 'Realtime Admin Panel',
    hook: 'Live admin dashboard with WebSocket updates and server-driven state.',
    category: 'sites',
  },
  {
    href: 'https://demos.mochi.fast/todo',
    title: 'Tailwind Todo App',
    hook: 'Classic todo app styled with Tailwind CSS.',
    category: 'sites',
  },
];
