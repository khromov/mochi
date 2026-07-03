import type { SourceSpec } from '../components/utils.ts';
import { files as api } from '../demos/api/files.ts';
import { files as cacheEvents } from '../demos/cache-events/files.ts';
import { files as chat } from '../demos/chat/files.ts';
import { files as clientOnly } from '../demos/client-only/files.ts';
import { files as cookieVaryTest } from '../demos/cookie-vary-test/files.ts';
import { files as cookies } from '../demos/cookies/files.ts';
import { files as dataLoading } from '../demos/data-loading/files.ts';
import { files as entityProps } from '../demos/entity-props/files.ts';
import { files as fetchDemo } from '../demos/fetch/files.ts';
import { files as error } from '../demos/error/files.ts';
import { files as errorBoundaries } from '../demos/error-boundaries/files.ts';
import { files as file } from '../demos/file/files.ts';
import { files as fileUpload } from '../demos/file-upload/files.ts';
import { files as fontLoading } from '../demos/font-loading/files.ts';
import { files as formCancel } from '../demos/form-cancel/files.ts';
import { files as formErrors } from '../demos/form-errors/files.ts';
import { files as formRedirects } from '../demos/form-redirects/files.ts';
import { files as formReturnData } from '../demos/form-return-data/files.ts';
import { files as helloWorld } from '../demos/hello-world/files.ts';
import { files as hydratable } from '../demos/hydratable/files.ts';
import { files as hydration } from '../demos/hydration/files.ts';
import { files as image } from '../demos/image/files.ts';
import { files as imageEvents } from '../demos/image-events/files.ts';
import { files as imagePipeline } from '../demos/image-pipeline/files.ts';
import { files as islandDepth } from '../demos/island-depth/files.ts';
import { files as islandProps } from '../demos/island-props/files.ts';
import { files as lazy } from '../demos/lazy/files.ts';
import { files as lazyServerIsland } from '../demos/lazy-server-island/files.ts';
import { files as login } from '../demos/login/files.ts';
import { files as mdsvex } from '../demos/mdsvex/files.ts';
import { files as nestedComponents } from '../demos/nested-components/files.ts';
import { files as nestedIslands } from '../demos/nested-islands/files.ts';
import { files as propDedup } from '../demos/prop-dedup/files.ts';
import { files as propsId } from '../demos/props-id/files.ts';
import { files as queue } from '../demos/queue/files.ts';
import { files as reloadFormData } from '../demos/reload-form-data/files.ts';
import { files as requestId } from '../demos/request-id/files.ts';
import { files as serverIsland } from '../demos/server-island/files.ts';
import { files as serverProps } from '../demos/server-props/files.ts';
import { files as sharedState } from '../demos/shared-state/files.ts';
import { files as streams } from '../demos/streams/files.ts';
import { files as url } from '../demos/url/files.ts';

export type DemoCategory = 'hydration' | 'data' | 'endpoints' | 'forms' | 'errors' | 'sites';

export interface Demo {
  href: string;
  title: string;
  hook: string;
  category: DemoCategory;
  /** Demo folder name. Present on internal demos that ship source; the key for their files/llms.txt. */
  slug?: string;
  /** Source files rendered on the demo page and bundled into its llms.txt. Keyed alongside `slug`. */
  files?: SourceSpec[];
}

export const categoryLabels: Record<DemoCategory, string> = {
  hydration: 'Basic',
  data: 'Data & serialization',
  endpoints: 'Endpoints & realtime',
  forms: 'Forms',
  errors: 'Errors',
  sites: 'Demo sites',
};

export const categoryOrder: DemoCategory[] = ['hydration', 'data', 'endpoints', 'forms', 'errors', 'sites'];

export const demos: Demo[] = [
  {
    href: '/demos/hello-world/',
    slug: 'hello-world',
    files: helloWorld,
    title: 'Hello World',
    hook: 'The simplest possible Mochi page — pure server-rendered Svelte.',
    category: 'hydration',
  },
  {
    href: '/demos/server-props/',
    slug: 'server-props',
    files: serverProps,
    title: 'Server Props',
    hook: 'Define serverProps on Mochi.page() to pass fresh data into a Svelte page on every request.',
    category: 'data',
  },
  {
    href: '/demos/hydration/',
    slug: 'hydration',
    files: hydration,
    title: 'Hydration Modes',
    hook: 'The same component rendered five ways — eager, lazy, visible, rootMargin-tuned, and deferred server island.',
    category: 'hydration',
  },
  {
    href: '/demos/data-loading/',
    slug: 'data-loading',
    files: dataLoading,
    title: 'Data Loading',
    hook: 'Server-side fetch from PokéAPI cached via MochiCache and rendered at request time.',
    category: 'data',
  },
  {
    href: '/demos/fetch/',
    slug: 'fetch',
    files: fetchDemo,
    title: 'Resilient Fetch',
    hook: 'mochiFetch() — a drop-in for fetch adding retries, a timeout, and a base URL — loads a Pokémon from PokéAPI.',
    category: 'data',
  },
  {
    href: '/demos/hydratable/',
    slug: 'hydratable',
    files: hydratable,
    title: 'Hydratable',
    hook: 'Compute a value once on the server with hydratable(); the hydrated island reads it from <head> instead of re-running the async work.',
    category: 'data',
  },
  {
    href: '/demos/cookies/',
    slug: 'cookies',
    files: cookies,
    title: 'Cookies',
    hook: 'Read and write cookies on the server and the client through one MochiCookieJar API.',
    category: 'data',
  },
  {
    href: '/demos/url/',
    slug: 'url',
    files: url,
    title: 'Isomorphic URL',
    hook: 'One import for the current URL — reads from the request on the server, window.location on the client.',
    category: 'data',
  },
  {
    href: '/demos/view-transitions/',
    title: 'View Transitions',
    hook: 'Drop <ViewTransitions /> into a shared layout to animate full-page navigations with zero JavaScript.',
    category: 'hydration',
  },
  {
    href: '/demos/custom-transitions/',
    title: 'Custom Transitions',
    hook: 'Bring your own @keyframes to <ViewTransitions /> via custom={{ in, out }} — here, a funky 3D spin.',
    category: 'hydration',
  },
  {
    href: '/demos/cache-events/',
    slug: 'cache-events',
    files: cacheEvents,
    title: 'Cache Events',
    hook: 'Subscribe to MochiCache lifecycle events through mochiEvents and log them to the server console.',
    category: 'data',
  },
  {
    href: '/demos/image/',
    slug: 'image',
    files: image,
    title: 'Image Resizing',
    hook: 'On-the-fly image resizing on Bun.Image, served from an encrypted, stale-while-revalidate disk cache.',
    category: 'data',
  },
  {
    href: '/demos/image-events/',
    slug: 'image-events',
    files: imageEvents,
    title: 'Image Events',
    hook: 'Subscribe to image:store / image:delete on mochiEvents to mirror the <Image> cache to durable storage like S3.',
    category: 'data',
  },
  {
    href: '/demos/image-pipeline/',
    slug: 'image-pipeline',
    files: imagePipeline,
    title: 'Advanced Image use',
    hook: 'Decode, resize, rotate, flip, modulate, and re-encode with the raw Bun.Image pipeline — every option, server-rendered to inline data URLs.',
    category: 'data',
  },
  {
    href: '/demos/request-id/',
    slug: 'request-id',
    files: requestId,
    title: 'Request ID',
    hook: 'Every request gets a UUID v7 — read it server-side via getRequestContext().requestId; the same id rides every lifecycle event for correlation.',
    category: 'data',
  },
  {
    href: '/cookie-vary-test/',
    slug: 'cookie-vary-test',
    files: cookieVaryTest,
    title: 'Cookie Vary Test',
    hook: 'A page that sets Vary: Cookie on its response — useful for testing cookie-partitioned cache keys.',
    category: 'data',
  },
  {
    href: '/demos/chat/',
    slug: 'chat',
    files: chat,
    title: 'Real-time Chat',
    hook: 'A hydrated island over a Mochi.ws() route, with pub/sub broadcast and in-memory history.',
    category: 'endpoints',
  },
  {
    href: '/demos/api/',
    slug: 'api',
    files: api,
    title: 'API Endpoints',
    hook: 'JSON routes defined with Mochi.api(), tested live against the running server.',
    category: 'endpoints',
  },
  {
    href: '/demos/file/',
    slug: 'file',
    files: file,
    title: 'File Routes',
    hook: 'Serve a file from disk with Mochi.file() — static path or a per-request resolver.',
    category: 'endpoints',
  },
  {
    href: '/demos/shared-state/',
    slug: 'shared-state',
    files: sharedState,
    title: 'Shared State',
    hook: 'Two separate islands sharing the same reactive $state.',
    category: 'hydration',
  },
  {
    href: '/demos/streams/',
    slug: 'streams',
    files: streams,
    title: 'Real-time Streams',
    hook: 'WebSocket and SSE clocks, lazily hydrated via mochi:hydrate:visible.',
    category: 'endpoints',
  },
  {
    href: '/demos/queue/',
    slug: 'queue',
    files: queue,
    title: 'Background jobs with queues',
    hook: 'Offload work to a Mochi.queue() with an embedded worker — no Redis.',
    category: 'endpoints',
  },
  {
    href: '/demos/server-island/',
    slug: 'server-island',
    files: serverIsland,
    title: 'Server Islands',
    hook: 'Components marked mochi:defer render server-side on demand after the initial page is delivered.',
    category: 'hydration',
  },
  {
    href: '/demos/island-props/',
    slug: 'island-props',
    files: islandProps,
    title: 'Crossing the server-client boundary with props',
    hook: 'How props travel from a server-rendered parent into a hydrated island — Date, Map, Set, BigInt, URL, typed arrays, and even cyclic refs survive devalue’s round-trip.',
    category: 'hydration',
  },
  {
    href: '/demos/client-only/',
    slug: 'client-only',
    files: clientOnly,
    title: 'Client-only Islands',
    hook: 'Components marked mochi:clientOnly skip SSR entirely and mount in the browser — a fallback snippet fills in until then.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy/',
    slug: 'lazy',
    files: lazy,
    title: 'Lazy Islands',
    hook: 'Islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy-server-island/',
    slug: 'lazy-server-island',
    files: lazyServerIsland,
    title: 'Lazy Server Islands',
    hook: 'Server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view.',
    category: 'hydration',
  },
  {
    href: '/demos/font-loading/',
    slug: 'font-loading',
    files: fontLoading,
    title: 'Font loading',
    hook: 'Ship fonts via @fontsource packages or standalone .woff2 files — automatically bundled and linked from the page head.',
    category: 'hydration',
  },
  {
    href: '/demos/mdsvex/',
    slug: 'mdsvex',
    files: mdsvex,
    title: 'MdSvex',
    hook: 'A .md file compiled through mdsvex and rendered as a Svelte component, with an embedded <script> block.',
    category: 'hydration',
  },
  {
    href: '/demos/nested-components/',
    slug: 'nested-components',
    files: nestedComponents,
    title: 'Nested Components',
    hook: 'A five-level recursive tree — hydrating the root carries the whole subtree in one island.',
    category: 'hydration',
  },
  {
    href: '/demos/nested-islands/',
    slug: 'nested-islands',
    files: nestedIslands,
    title: 'Nested Islands',
    hook: 'Islands inside islands — a mochi:defer server island wrapping mochi:hydrate components, and a server island nesting both a deferred and a deferred-hydrated server island.',
    category: 'hydration',
  },
  {
    href: '/demos/island-depth/',
    slug: 'island-depth',
    files: islandDepth,
    title: 'Nested Island Max Depth',
    hook: 'A chain of mochi:defer server islands nested four levels deep — each fetches the next on demand, and the prebuild precompiles the whole chain.',
    category: 'hydration',
  },
  {
    href: '/demos/prop-dedup/',
    slug: 'prop-dedup',
    files: propDedup,
    title: 'Shared Props',
    hook: 'Nine islands, three unique payloads — each set serialized once and referenced via props-ref.',
    category: 'hydration',
  },
  {
    href: '/demos/props-id/',
    slug: 'props-id',
    files: propsId,
    title: 'Unique IDs',
    hook: "Svelte's native $props.id() inside islands — SSR-consistent, unique per instance, namespaced in server islands.",
    category: 'hydration',
  },
  {
    href: '/demos/login/',
    slug: 'login',
    files: login,
    title: 'Form Actions',
    hook: 'A login form rendered twice — plain HTML POST and intercepted with {@attach enhance(...)}.',
    category: 'forms',
  },
  {
    href: '/demos/form-return-data/',
    slug: 'form-return-data',
    files: formReturnData,
    title: 'Using form return data',
    hook: 'An action returns data via success({...}); {@attach enhance(...)} updates the UI in place, plain HTML re-renders the page.',
    category: 'forms',
  },
  {
    href: '/demos/form-errors/',
    slug: 'form-errors',
    files: formErrors,
    title: 'Form Errors',
    hook: 'A thrown action error shown inline via {@attach enhance(...)}, or as the Mochi error page on plain submit.',
    category: 'forms',
  },
  {
    href: '/demos/form-redirects/',
    slug: 'form-redirects',
    files: formRedirects,
    title: 'Form Redirects',
    hook: 'redirect(303, …) intercepted as a JSON envelope by {@attach enhance(...)}, or followed natively by the browser.',
    category: 'forms',
  },
  {
    href: '/demos/file-upload/',
    slug: 'file-upload',
    files: fileUpload,
    title: 'File Uploads via form actions',
    hook: 'multipart/form-data submission, validated with fail() and success(), shown enhanced and plain.',
    category: 'forms',
  },
  {
    href: '/demos/reload-form-data/',
    slug: 'reload-form-data',
    files: reloadFormData,
    title: 'Reloading associated form data',
    hook: 'After a successful submit, refetch the related list inside enhance() — or rely on the post-POST re-render.',
    category: 'forms',
  },
  {
    href: '/demos/form-cancel/',
    slug: 'form-cancel',
    files: formCancel,
    title: 'Cancelling form submissions',
    hook: 'cancel() prevents the fetch from firing; controller.abort() stops one mid-flight.',
    category: 'forms',
  },
  {
    href: '/demos/error/',
    slug: 'error',
    files: error,
    title: 'Error Handling',
    hook: 'Catch render errors and unmatched routes via Mochi.serve()’s errorPage option and the handleError hook.',
    category: 'errors',
  },
  {
    href: '/demos/error-boundaries/',
    slug: 'error-boundaries',
    files: errorBoundaries,
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
  {
    href: '/demos/entity-props/',
    slug: 'entity-props',
    files: entityProps,
    title: 'HTML Entities in Props',
    hook: 'HTML entities in a static island prop (label="Tom &amp; Jerry") decode to their characters — identical on the server and after hydration.',
    category: 'hydration',
  },
];
