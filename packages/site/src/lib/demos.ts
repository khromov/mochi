import type { SourceSpec } from '../components/utils.ts';
import { files as api } from '../demos/api/files.ts';
import { files as cacheEvents } from '../demos/cache-events/files.ts';
import { files as chat } from '../demos/chat/files.ts';
import { files as clientOnly } from '../demos/client-only/files.ts';
import { files as cookieVaryTest } from '../demos/cookie-vary-test/files.ts';
import { files as captcha } from '../demos/captcha/files.ts';
import { files as captchaStyling } from '../demos/captcha-styling/files.ts';
import { files as cookies } from '../demos/cookies/files.ts';
import { files as customTransitions } from '../demos/custom-transitions/files.ts';
import { files as dataLoading } from '../demos/data-loading/files.ts';
import { files as email } from '../demos/email/files.ts';
import { files as entityProps } from '../demos/entity-props/files.ts';
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
import { files as isHydratableFiles } from '../demos/is-hydratable/files.ts';
import { files as hydration } from '../demos/hydration/files.ts';
import { files as image } from '../demos/image/files.ts';
import { files as imageInvalidation } from '../demos/image-invalidation/files.ts';
import { files as imagePipeline } from '../demos/image-pipeline/files.ts';
import { files as imageEvents } from '../demos/image-events/files.ts';
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
import { files as rateLimit } from '../demos/rate-limit/files.ts';
import { files as reloadFormData } from '../demos/reload-form-data/files.ts';
import { files as requestCache } from '../demos/request-cache/files.ts';
import { files as requestId } from '../demos/request-id/files.ts';
import { files as serverIsland } from '../demos/server-island/files.ts';
import { files as serverProps } from '../demos/server-props/files.ts';
import { files as sharedState } from '../demos/shared-state/files.ts';
import { files as streams } from '../demos/streams/files.ts';
import { files as url } from '../demos/url/files.ts';
import { files as viewTransitions } from '../demos/view-transitions/files.ts';

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
  /** Repo paths for the "view source" links, overriding the `packages/site/src/demos/<slug>` default — needed when a framework convention (e.g. prebuilt email templates living in `src/emails/`) forces part of a demo out of its own folder. */
  sourcePaths?: string[];
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
    hook: 'How server-side rendering works — a Mochi.page() renders Svelte on the server and ships zero JavaScript.',
    category: 'hydration',
  },
  {
    href: '/demos/server-props/',
    slug: 'server-props',
    files: serverProps,
    title: 'Server Props',
    hook: 'How server props work — pass fresh per-request data into a page via serverProps on Mochi.page().',
    category: 'data',
  },
  {
    href: '/demos/hydration/',
    slug: 'hydration',
    files: hydration,
    title: 'Hydration Modes',
    hook: 'How the hydration modes work — mochi:hydrate, mochi:hydrate:visible, rootMargin tuning, and mochi:defer server islands side by side.',
    category: 'hydration',
  },
  {
    href: '/demos/data-loading/',
    slug: 'data-loading',
    files: dataLoading,
    title: 'Data Loading',
    hook: 'How server-side data loading works — fetch on the server, cache with MochiCache, and render at request time.',
    category: 'data',
  },
  {
    href: '/demos/hydratable/',
    slug: 'hydratable',
    files: hydratable,
    title: 'Hydratable',
    hook: 'How hydratable() works — compute a value once on the server and reuse it on the client instead of re-running async work during hydration.',
    category: 'hydration',
  },
  {
    href: '/demos/is-hydratable/',
    slug: 'is-hydratable',
    files: isHydratableFiles,
    title: 'isHydratable()',
    hook: 'How isHydratable() works — detect from any depth whether the current subtree will hydrate, for SSR-only fallbacks without prop forwarding.',
    category: 'hydration',
  },
  {
    href: '/demos/cookies/',
    slug: 'cookies',
    files: cookies,
    title: 'Cookies',
    hook: 'How cookies work — read and write on the server and the client through one MochiCookieJar API (cookies.get/set/delete).',
    category: 'data',
  },
  {
    href: '/demos/url/',
    slug: 'url',
    files: url,
    title: 'Isomorphic URL',
    hook: 'How the isomorphic URL helper works — one import that reads the request URL on the server and window.location on the client.',
    category: 'data',
  },
  {
    href: '/demos/view-transitions/',
    slug: 'view-transitions',
    files: viewTransitions,
    title: 'View Transitions',
    hook: 'How view transitions work — drop <ViewTransitions /> into a layout to animate full-page navigations with zero JavaScript.',
    category: 'hydration',
  },
  {
    href: '/demos/custom-transitions/',
    slug: 'custom-transitions',
    files: customTransitions,
    title: 'Custom Transitions',
    hook: 'How custom view transitions work — supply your own @keyframes to <ViewTransitions /> via custom={{ in, out }}.',
    category: 'hydration',
  },
  {
    href: '/demos/cache-events/',
    slug: 'cache-events',
    files: cacheEvents,
    title: 'Cache Events',
    hook: 'How cache events work — subscribe to MochiCache lifecycle events (hit, miss, set, evict) through mochiEvents for observability.',
    category: 'data',
  },
  {
    href: '/demos/request-cache/',
    slug: 'request-cache',
    files: requestCache,
    title: 'Request Cache',
    hook: 'How the request cache works — requestMemo and requestCache run an expensive computation once per request no matter how many components call it, then discard it at the request boundary.',
    category: 'data',
  },
  {
    href: '/demos/image/',
    slug: 'image',
    files: image,
    title: 'Image: Component',
    hook: 'How the <Image> component works — named sizes, ThumbHash blur-up placeholders, and encrypted deferred URLs whose transforms run lazily on the endpoint.',
    category: 'data',
  },
  {
    href: '/demos/image-invalidation/',
    slug: 'image-invalidation',
    files: imageInvalidation,
    title: 'Image: Invalidation',
    hook: 'How image invalidation works — invalidateImage() hard-evicts the shared original so every named size re-fetches in lockstep.',
    category: 'data',
  },
  {
    href: '/demos/image-pipeline/',
    slug: 'image-pipeline',
    files: imagePipeline,
    title: 'Image: Named sizes',
    hook: 'How the image transform pipeline works — declare resize / rotate / flip / modulate / format as named sizes; getImageUrl mints a deferred URL, getImage runs one inline.',
    category: 'data',
  },
  {
    href: '/demos/image-events/',
    slug: 'image-events',
    files: imageEvents,
    title: 'Image: Events',
    hook: 'How image events work — subscribe to image:store / image:delete on mochiEvents to mirror the <Image> cache to durable storage like S3.',
    category: 'data',
  },
  {
    href: '/demos/request-id/',
    slug: 'request-id',
    files: requestId,
    title: 'Request ID',
    hook: 'How request IDs work — every request gets a UUID v7 on getRequestContext().requestId that rides every lifecycle event for correlation.',
    category: 'data',
  },
  {
    href: '/cookie-vary-test/',
    slug: 'cookie-vary-test',
    files: cookieVaryTest,
    title: 'Cookie Vary Test',
    hook: 'How cookie-partitioned caching works — a page that sets Vary: Cookie so responses key on cookies.',
    category: 'data',
  },
  {
    href: '/demos/chat/',
    slug: 'chat',
    files: chat,
    title: 'Real-time Chat',
    hook: 'How WebSocket routes work — a hydrated island over Mochi.ws() with pub/sub broadcast and in-memory history.',
    category: 'endpoints',
  },
  {
    href: '/demos/api/',
    slug: 'api',
    files: api,
    title: 'API Endpoints',
    hook: 'How API routes work — define JSON endpoints with Mochi.api(), tested live against the running server.',
    category: 'endpoints',
  },
  {
    href: '/demos/rate-limit/',
    slug: 'rate-limit',
    files: rateLimit,
    title: 'Rate Limiting',
    hook: 'How rate limiting works — a rateLimit config on the route caps requests per IP per minute and serves the 429 error page past the limit.',
    category: 'endpoints',
  },
  {
    href: '/demos/file/',
    slug: 'file',
    files: file,
    title: 'File Routes',
    hook: 'How file routes work — serve a file from disk with Mochi.file(), as a static path or a per-request resolver.',
    category: 'endpoints',
  },
  {
    href: '/demos/shared-state/',
    slug: 'shared-state',
    files: sharedState,
    title: 'Shared State',
    hook: 'How shared state across islands works — two separate islands driving the same reactive $state.',
    category: 'hydration',
  },
  {
    href: '/demos/streams/',
    slug: 'streams',
    files: streams,
    title: 'Real-time Streams',
    hook: 'How server-sent events and WebSocket streaming work — live SSE and WebSocket clocks, lazily hydrated via mochi:hydrate:visible.',
    category: 'endpoints',
  },
  {
    href: '/demos/queue/',
    slug: 'queue',
    files: queue,
    title: 'Background jobs with queues',
    hook: 'How background job queues work — offload work to a Mochi.queue() with an embedded worker, no Redis.',
    category: 'endpoints',
  },
  {
    href: '/demos/server-island/',
    slug: 'server-island',
    files: serverIsland,
    title: 'Server Islands',
    hook: 'How server islands work — components marked mochi:defer render server-side on demand after the initial page is delivered.',
    category: 'hydration',
  },
  {
    href: '/demos/island-props/',
    slug: 'island-props',
    files: islandProps,
    title: 'Crossing the server-client boundary with props',
    hook: "How props cross the server-client boundary — Date, Map, Set, BigInt, URL, typed arrays, and even cyclic refs survive devalue's round-trip into a hydrated island.",
    category: 'hydration',
  },
  {
    href: '/demos/client-only/',
    slug: 'client-only',
    files: clientOnly,
    title: 'Client-only Islands',
    hook: 'How client-only islands work — components marked mochi:clientOnly skip SSR and mount in the browser, with a fallback snippet until then.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy/',
    slug: 'lazy',
    files: lazy,
    title: 'Lazy Islands',
    hook: 'How lazy hydration works — islands marked mochi:hydrate:visible hydrate and load their CSS only when scrolled into view.',
    category: 'hydration',
  },
  {
    href: '/demos/lazy-server-island/',
    slug: 'lazy-server-island',
    files: lazyServerIsland,
    title: 'Lazy Server Islands',
    hook: 'How lazy server islands work — server islands marked mochi:defer:visible only fetch when the wrapper scrolls into view.',
    category: 'hydration',
  },
  {
    href: '/demos/font-loading/',
    slug: 'font-loading',
    files: fontLoading,
    title: 'Font loading',
    hook: 'How font loading works — ship fonts via @fontsource packages or standalone .woff2 files, automatically bundled and linked from the page head.',
    category: 'hydration',
  },
  {
    href: '/demos/mdsvex/',
    slug: 'mdsvex',
    files: mdsvex,
    title: 'MdSvex',
    hook: 'How mdsvex works — a .md file compiled through mdsvex and rendered as a Svelte component, embedded <script> and all.',
    category: 'hydration',
  },
  {
    href: '/demos/nested-components/',
    slug: 'nested-components',
    files: nestedComponents,
    title: 'Nested Components',
    hook: 'How whole-subtree hydration works — a five-level recursive tree where hydrating the root carries the entire subtree in one island.',
    category: 'hydration',
  },
  {
    href: '/demos/nested-islands/',
    slug: 'nested-islands',
    files: nestedIslands,
    title: 'Nested Islands',
    hook: 'How nested islands work — a mochi:defer server island wrapping mochi:hydrate components, and server islands nesting more server islands.',
    category: 'hydration',
  },
  {
    href: '/demos/island-depth/',
    slug: 'island-depth',
    files: islandDepth,
    title: 'Nested Island Max Depth',
    hook: 'How deeply nested server islands work — a four-level mochi:defer chain where each level fetches the next on demand and the prebuild precompiles the whole chain.',
    category: 'hydration',
  },
  {
    href: '/demos/prop-dedup/',
    slug: 'prop-dedup',
    files: propDedup,
    title: 'Shared Props',
    hook: 'How island prop deduplication works — nine islands share three unique payloads, each serialized once and referenced via props-ref.',
    category: 'hydration',
  },
  {
    href: '/demos/props-id/',
    slug: 'props-id',
    files: propsId,
    title: 'Unique IDs',
    hook: "How stable island IDs work — Svelte's native $props.id() gives SSR-consistent, per-instance ids, namespaced inside server islands.",
    category: 'hydration',
  },
  {
    href: '/demos/login/',
    slug: 'login',
    files: login,
    title: 'Form Actions',
    hook: 'How form actions work — a form rendered twice, as a plain HTML POST and intercepted with {@attach enhance(...)}.',
    category: 'forms',
  },
  {
    href: '/demos/email/',
    slug: 'email',
    files: email,
    sourcePaths: ['packages/site/src/demos/email', 'packages/site/src/emails'],
    title: 'Send Email',
    hook: 'How sending email works — dispatch through Mochi.email() and read it back in the /_mochi/email dev outbox.',
    category: 'forms',
  },
  {
    href: '/demos/form-return-data/',
    slug: 'form-return-data',
    files: formReturnData,
    title: 'Using form return data',
    hook: 'How form action return data works — an action returns success({...}); {@attach enhance(...)} updates the UI in place, plain HTML re-renders.',
    category: 'forms',
  },
  {
    href: '/demos/form-errors/',
    slug: 'form-errors',
    files: formErrors,
    title: 'Form Errors',
    hook: 'How form action errors work — a thrown action error shows inline via {@attach enhance(...)}, or as the Mochi error page on a plain submit.',
    category: 'forms',
  },
  {
    href: '/demos/form-redirects/',
    slug: 'form-redirects',
    files: formRedirects,
    title: 'Form Redirects',
    hook: 'How form action redirects work — redirect(303, …) is intercepted as a JSON envelope by {@attach enhance(...)} or followed natively by the browser.',
    category: 'forms',
  },
  {
    href: '/demos/file-upload/',
    slug: 'file-upload',
    files: fileUpload,
    title: 'File Uploads via form actions',
    hook: 'How file uploads through form actions work — multipart/form-data validated with fail() and success(), shown enhanced and plain.',
    category: 'forms',
  },
  {
    href: '/demos/reload-form-data/',
    slug: 'reload-form-data',
    files: reloadFormData,
    title: 'Reloading associated form data',
    hook: 'How reloading associated data works — after a successful submit, refetch the related list inside enhance(), or rely on the post-POST re-render.',
    category: 'forms',
  },
  {
    href: '/demos/captcha/',
    slug: 'captcha',
    files: captcha,
    title: 'Captcha',
    hook: 'How the captcha works — slide-to-verify backed by a hash chain and proof-of-work, with no third party and no tracking.',
    category: 'forms',
  },
  {
    href: '/demos/captcha-styling/',
    slug: 'captcha-styling',
    files: captchaStyling,
    title: 'Captcha Styling',
    hook: 'How captcha theming works — the same captcha four ways, every colour a CSS custom property with a built-in fallback.',
    category: 'forms',
  },
  {
    href: '/demos/form-cancel/',
    slug: 'form-cancel',
    files: formCancel,
    title: 'Cancelling form submissions',
    hook: 'How cancelling form submissions works — cancel() stops the fetch before it fires; controller.abort() stops one mid-flight.',
    category: 'forms',
  },
  {
    href: '/demos/error/',
    slug: 'error',
    files: error,
    title: 'Error Handling',
    hook: "How error handling works — catch render errors and unmatched routes via Mochi.serve()'s errorPage option and the handleError hook.",
    category: 'errors',
  },
  {
    href: '/demos/error-boundaries/',
    slug: 'error-boundaries',
    files: errorBoundaries,
    title: 'Error Boundaries',
    hook: "How error boundaries work — contain island failures with <svelte:boundary> so one broken component doesn't crash the page.",
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
    hook: 'How HTML entities in island props work — an entity in a static prop (label="Tom &amp; Jerry") decodes identically on the server and after hydration.',
    category: 'hydration',
  },
];
