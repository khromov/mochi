# Changelog

## [0.10.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.9.1...mochi-framework-v0.10.0) (2026-09-06)


### ⚠ BREAKING CHANGES

* derive dev mode from NODE_ENV, and export isDev/isServer/isBrowser for real ([#338](https://github.com/khromov/mochi/issues/338))
* Mochi now requires Bun >=1.4.0.
* make declared queue config authoritative over storage ([#317](https://github.com/khromov/mochi/issues/317))
* stop redirecting unmatched paths under trailingSlash ([#314](https://github.com/khromov/mochi/issues/314))
* `trailingSlash` no longer applies to `Mochi.api()`, `Mochi.sse()`, `Mochi.ws()` or `Mochi.file()` routes — only the exact pattern you declared matches, and the other slash form 404s instead of redirecting or being mirrored. Two failure modes to check on upgrade: an SSE client is the one case whose *declared* form previously redirected, so a client hardcoded to the redirect target now 404s; and a WebSocket client on the wrong slash form fails as an opaque connection error rather than a visible status. Either fix the caller to use the declared pattern, or register both patterns against one route:
* **fonts:** emit fonts from imported CSS as separate assets ([#292](https://github.com/khromov/mochi/issues/292))
* children on a plain `mochi:hydrate` / `mochi:hydrate:visible` island — body content or a snippet-valued `children` attribute — are now a hard compile error. They previously compiled and rendered server-side but silently vanished on hydration. Move the markup inside the island component, pass serializable props, or use `mochi:defer*`, where children are the loading fallback.
* replace bunqueue with bun-boss as the queue backend ([#269](https://github.com/khromov/mochi/issues/269))
* inline nested mochi:defer islands into the parent island fetch ([#257](https://github.com/khromov/mochi/issues/257))
* move svelte-shaker into @mochi-framework/svelte-shaker ([#255](https://github.com/khromov/mochi/issues/255))

### Features

* add isBuilding constant, true during mochi-framework build ([#279](https://github.com/khromov/mochi/issues/279)) ([3c33d6c](https://github.com/khromov/mochi/commit/3c33d6c522b9175ac531e5e029c990be41fe2e0b))
* adopt Bun 1.4 APIs (cron, staticDirs, memory pressure, streaming compression, WebView, RSS) ([#330](https://github.com/khromov/mochi/issues/330)) ([4faac0f](https://github.com/khromov/mochi/commit/4faac0f723cf5bed1514fb8bf077c427fd811193))
* **cache:** add MochiCache.whenIdle() ([#311](https://github.com/khromov/mochi/issues/311)) ([25a9269](https://github.com/khromov/mochi/commit/25a9269b9160ba6dcd505b9e5e6fbe5db8189368))
* derive dev mode from NODE_ENV, and export isDev/isServer/isBrowser for real ([#338](https://github.com/khromov/mochi/issues/338)) ([4fbb17c](https://github.com/khromov/mochi/commit/4fbb17c60d09be41881ceabee350cd16d3ddd1bf))
* first-class Speculation Rules support ([#298](https://github.com/khromov/mochi/issues/298)) ([b23fe7e](https://github.com/khromov/mochi/commit/b23fe7e1dfc1b4f64cc64c1cad3184cac680cc7e))
* fix silent edges from SvelteKit-porting feedback ([#290](https://github.com/khromov/mochi/issues/290)) ([80968a6](https://github.com/khromov/mochi/commit/80968a65d5f7ca9b0c4566faca334cd15f421c56))
* **fonts:** emit fonts from imported CSS as separate assets ([#292](https://github.com/khromov/mochi/issues/292)) ([db727b3](https://github.com/khromov/mochi/commit/db727b3a073b08010420f4c3490891a2f9ffa457))
* include queued job count in large-backlog queue warning ([#323](https://github.com/khromov/mochi/issues/323)) ([57ed177](https://github.com/khromov/mochi/commit/57ed1778fc2d098a1e9f740cf7fcd4005c05fc9f))
* inline nested mochi:defer islands into the parent island fetch ([#257](https://github.com/khromov/mochi/issues/257)) ([97c0700](https://github.com/khromov/mochi/commit/97c0700c36fadd35f33a8c93f2cfb55e0e19641a))
* make declared queue config authoritative over storage ([#317](https://github.com/khromov/mochi/issues/317)) ([480236b](https://github.com/khromov/mochi/commit/480236b1c82b4b12747ae6612417964093fbe4cd))
* **mochi:** export MochiHttpError; fix docs code samples surfaced by validation ([#280](https://github.com/khromov/mochi/issues/280)) ([e361441](https://github.com/khromov/mochi/commit/e361441771b8ba0eb513299a94c31eefe409acec))
* **mochi:** export pinGlobal; dedupe the site's Shiki highlighter per process ([#247](https://github.com/khromov/mochi/issues/247)) ([8979aad](https://github.com/khromov/mochi/commit/8979aad307b0e9df8e07b227dca12a402e9e9805))
* **mochi:** reload server islands with reloadDeferredIsland ([#312](https://github.com/khromov/mochi/issues/312)) ([67bc315](https://github.com/khromov/mochi/commit/67bc3152339cf230fa498d0579ed69f754a146c1))
* **mochi:** strip SSR-only .server.svelte components from client bundles ([#272](https://github.com/khromov/mochi/issues/272)) ([2a7e2d9](https://github.com/khromov/mochi/commit/2a7e2d93a471d1692f386dfd5930954b4333fce1))
* move svelte-shaker into @mochi-framework/svelte-shaker ([#255](https://github.com/khromov/mochi/issues/255)) ([b675ce6](https://github.com/khromov/mochi/commit/b675ce6fbbda3749107fcc00d108f42f9cf55933))
* protection mode — browser-verification interstitial with auto-solving captcha ([#309](https://github.com/khromov/mochi/issues/309)) ([b12ae54](https://github.com/khromov/mochi/commit/b12ae54be137f48be681c22c232f70d7c8a090c4))
* **queues:** add embedded pglite queue storage ([#277](https://github.com/khromov/mochi/issues/277)) ([2457c7f](https://github.com/khromov/mochi/commit/2457c7f0724dc1e38bb76c0e60ce16cffc0e0981))
* replace bunqueue with bun-boss as the queue backend ([#269](https://github.com/khromov/mochi/issues/269)) ([c551965](https://github.com/khromov/mochi/commit/c551965dc4f9a24b200dc8ae9bf1c08a045fa732))
* require Bun &gt;=1.4 ([#326](https://github.com/khromov/mochi/issues/326)) ([bfe317c](https://github.com/khromov/mochi/commit/bfe317c348b804d9f9f855c9db2f3c62a985f0b5))
* **types:** type-check mochi:* directives on components without patching svelte-check ([#342](https://github.com/khromov/mochi/issues/342)) ([d9a07cc](https://github.com/khromov/mochi/commit/d9a07cc7316041be116aeb2ca1d3182c0454aecb))
* warn when route-handler HMR repeatedly re-creates module state ([#324](https://github.com/khromov/mochi/issues/324)) ([a037bcb](https://github.com/khromov/mochi/commit/a037bcba40e908b91bc36eb4b78caa2c99edb041))


### Bug Fixes

* apply trailingSlash to page routes only ([#150](https://github.com/khromov/mochi/issues/150)) ([2353ac8](https://github.com/khromov/mochi/commit/2353ac8303f604301fd34cc5916577a001f063e3))
* close the MochiCache lost-update race between set() and an unregistered fetch ([#348](https://github.com/khromov/mochi/issues/348)) ([9b7c65c](https://github.com/khromov/mochi/commit/9b7c65c2645b7f2aa50c0063e0118be8d2f424f9))
* **debug-bar:** isolate panel render faults behind a boundary, with a diagnostic build flag ([#274](https://github.com/khromov/mochi/issues/274)) ([d3fc546](https://github.com/khromov/mochi/commit/d3fc546ed39a3a34744c553b593c7fd32c27929d))
* **debug-bar:** keep the install-store version segment in bundle input paths ([#275](https://github.com/khromov/mochi/issues/275)) ([3c9f9af](https://github.com/khromov/mochi/commit/3c9f9afd89493e6bb1f52d171b92510caf91566a))
* **debug-bar:** match svelte inputs under the isolated linker in "Hide Svelte" ([#296](https://github.com/khromov/mochi/issues/296)) ([d715f28](https://github.com/khromov/mochi/commit/d715f28ae46dd5c3e9ba874af036ccb4d8955e36))
* **debug-bar:** only list chunks the page actually loads ([#223](https://github.com/khromov/mochi/issues/223)) ([c2b7446](https://github.com/khromov/mochi/commit/c2b7446294ed46a80c228953d965f3969122e624))
* **deps:** update dependencies across the monorepo ([#246](https://github.com/khromov/mochi/issues/246)) ([caf435c](https://github.com/khromov/mochi/commit/caf435cbd1fed5321d259e84909909bf50819478))
* **dev:** recompile pages for modules shared by the server entry ([#319](https://github.com/khromov/mochi/issues/319)) ([2ed7b14](https://github.com/khromov/mochi/commit/2ed7b1425b49914a2dd6ebea3cfe3aa6b16e6fa9))
* **fonts:** don't hash a half-written font copy into the served asset name ([#302](https://github.com/khromov/mochi/issues/302)) ([a516ab7](https://github.com/khromov/mochi/commit/a516ab710eed3fad6f051ccaf25bd5e91ee42bcc))
* **islands:** scope props-ref lookup to enclosing server island ([#340](https://github.com/khromov/mochi/issues/340)) ([ea1c97b](https://github.com/khromov/mochi/commit/ea1c97bdbacdad2339828adeeacc43661ffc75c9))
* minify imported CSS bundles ([#301](https://github.com/khromov/mochi/issues/301)) ([99b6bf2](https://github.com/khromov/mochi/commit/99b6bf2543f3d584241977cbe5ed0ac302205e0d))
* **mochi:** stop a Windows rename livelock in the image cache ([#315](https://github.com/khromov/mochi/issues/315)) ([0800d83](https://github.com/khromov/mochi/commit/0800d83f52c714197ef6653d36e44b2ed680c405))
* **queue:** configurable graceful queue-drain timeout on shutdown ([#328](https://github.com/khromov/mochi/issues/328)) ([e76579b](https://github.com/khromov/mochi/commit/e76579b8a6a389e087599d233aca362565b21e43))
* **queues:** apply deadLetter on the standalone worker path ([#316](https://github.com/khromov/mochi/issues/316)) ([77ed163](https://github.com/khromov/mochi/commit/77ed1639a2e43046fccaba30f05d8e37319b7f1e))
* **queues:** floor the batch-deadline reserve at 250ms ([#286](https://github.com/khromov/mochi/issues/286)) ([5476969](https://github.com/khromov/mochi/commit/54769699ceebf0f27052ed6eb8dbcf1ab75b6001))
* resolve component-url against the page and keep SSR markup when hydration fails ([#343](https://github.com/khromov/mochi/issues/343)) ([77b76bc](https://github.com/khromov/mochi/commit/77b76bc8514f71aaf7777ee7262a2bcda807529a))
* **rsvelte:** diagnose a missing Windows C runtime instead of a missing package ([#341](https://github.com/khromov/mochi/issues/341)) ([21cd85f](https://github.com/khromov/mochi/commit/21cd85fea5fcd60a7586e67598efa328319b286e))
* stop redirecting unmatched paths under trailingSlash ([#314](https://github.com/khromov/mochi/issues/314)) ([33a93a9](https://github.com/khromov/mochi/commit/33a93a980b4fcc57989fcf4fb9a350cbc4d62416))


### Performance

* **debug-bar:** compile the debug bar standalone with production-mode Svelte ([#266](https://github.com/khromov/mochi/issues/266)) ([c3dadc7](https://github.com/khromov/mochi/commit/c3dadc7d9d0c6607abc3b6e506056b0d63f56d90))
* skip request-invariant post-render scans on island-free pages ([#313](https://github.com/khromov/mochi/issues/313)) ([07f7da1](https://github.com/khromov/mochi/commit/07f7da11dc45d9be7794c0db3542034caa2d8e50))


### Code Refactoring

* **queues:** drop batchSize/burst and the batch-deadline machinery ([#287](https://github.com/khromov/mochi/issues/287)) ([94c8dfc](https://github.com/khromov/mochi/commit/94c8dfc292504e1be2f3c0394b0ae19ec4da47d7))

## [0.9.1](https://github.com/khromov/mochi/compare/mochi-framework-v0.9.0...mochi-framework-v0.9.1) (2026-07-30)


### Bug Fixes

* **cache:** run one FileStorage sweeper per directory ([#227](https://github.com/khromov/mochi/issues/227)) ([45f2c7b](https://github.com/khromov/mochi/commit/45f2c7b6ab3153a41d2a5db14b33b0f97e6561b6))

## [0.9.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.8.2...mochi-framework-v0.9.0) (2026-07-28)


### ⚠ BREAKING CHANGES

* **build:** precompile src/emails templates into the manifest - email templates must now be in src/emails ([#220](https://github.com/khromov/mochi/issues/220))
* relocatable build output — manifest v2, publicDir served from disk ([#170](https://github.com/khromov/mochi/issues/170))

### Features

* add optional rsvelte compiler backend ([#197](https://github.com/khromov/mochi/issues/197)) ([df9aede](https://github.com/khromov/mochi/commit/df9aede35eb49cc9ff74a86ef867939bb84b5ccc))
* **build:** precompile src/emails templates into the manifest - email templates must now be in src/emails ([#220](https://github.com/khromov/mochi/issues/220)) ([000e193](https://github.com/khromov/mochi/commit/000e193233227f49484d99d5076b0ceb9a2ab13b))
* **captcha:** fix hang, sync PoW, a11y/CLS, configurable bits/budget ([#199](https://github.com/khromov/mochi/issues/199)) ([5028c6b](https://github.com/khromov/mochi/commit/5028c6b616119c0cd647715050cb982ac0b7f6d5))
* **extensions:** crash when server-only internals reach the client ([#206](https://github.com/khromov/mochi/issues/206)) ([ad496ee](https://github.com/khromov/mochi/commit/ad496eec94ee43127ef2b6d2c38cb44f3b313156))
* memlab heap-snapshot analyzer + property-based fuzzing suite ([#203](https://github.com/khromov/mochi/issues/203)) ([49b3c85](https://github.com/khromov/mochi/commit/49b3c857e0e1635ca1c68a9918ae5d548e80c767))
* relocatable build output — manifest v2, publicDir served from disk ([#170](https://github.com/khromov/mochi/issues/170)) ([b31c052](https://github.com/khromov/mochi/commit/b31c05277a10196a8ba73ea74b88268e7a891bc5))
* request cache ([#202](https://github.com/khromov/mochi/issues/202)) ([9dd20b6](https://github.com/khromov/mochi/commit/9dd20b675b80d8f28176f3c570e7223cf3d34be8))
* warn at boot when publicDir was non-empty at build time but empty at serve ([#214](https://github.com/khromov/mochi/issues/214)) ([f807d31](https://github.com/khromov/mochi/commit/f807d3141db80f033fc708c9c3a8763ffa55138b))


### Bug Fixes

* require svelte-shaker &gt;=0.18.1 so mochi: directives survive shaking ([#221](https://github.com/khromov/mochi/issues/221)) ([f5b4522](https://github.com/khromov/mochi/commit/f5b45224756b2b6431b402a66be3dc9790e83cf1))


### Documentation

* **mochi:** slim down over-verbose source comments ([#217](https://github.com/khromov/mochi/issues/217)) ([82b29f6](https://github.com/khromov/mochi/commit/82b29f6bf55b6f978fbe99742a2c3fff831da34d))

## [0.8.2](https://github.com/khromov/mochi/compare/mochi-framework-v0.8.1...mochi-framework-v0.8.2) (2026-07-21)


### Bug Fixes

* **email:** stop nodemailer TS7016 leaking from the value-level import ([#194](https://github.com/khromov/mochi/issues/194)) ([9575619](https://github.com/khromov/mochi/commit/9575619a416bc2a21aaddbd99c9fc503f3067f34))

## [0.8.1](https://github.com/khromov/mochi/compare/mochi-framework-v0.8.0...mochi-framework-v0.8.1) (2026-07-21)


### Bug Fixes

* **email:** stop leaking a nodemailer TS7016 error into consumers ([#192](https://github.com/khromov/mochi/issues/192)) ([4eb74f2](https://github.com/khromov/mochi/commit/4eb74f2c80e7c886916551680d062048bcb96730))

## [0.8.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.7.0...mochi-framework-v0.8.0) (2026-07-21)


### Features

* add mochi:clientOnly and mochi:clientOnly:visible directives for browser-only components ([#89](https://github.com/khromov/mochi/issues/89)) ([5f318dc](https://github.com/khromov/mochi/commit/5f318dcebc052030652947600b181fb02d2143a0))
* add Mochi.email() transactional mailer ([#140](https://github.com/khromov/mochi/issues/140)) ([58a4850](https://github.com/khromov/mochi/commit/58a485009355e3f3f0b56e4e7e110d820383c556))
* add signed image-resize API with stale-while-revalidate cache ([#65](https://github.com/khromov/mochi/issues/65)) ([d1fb6b6](https://github.com/khromov/mochi/commit/d1fb6b68ae185386ad266b5e437a716a2b0e02d4))
* **cli:** add `bunx mochi-framework generate-key` command ([#114](https://github.com/khromov/mochi/issues/114)) ([f47a029](https://github.com/khromov/mochi/commit/f47a029cfc309a3bd2c24ca4fef67917b319262f))
* **image:** support Vite-style local image imports and filesystem imports ([#169](https://github.com/khromov/mochi/issues/169)) ([33beb89](https://github.com/khromov/mochi/commit/33beb8956786e7a182fe9b9262b0d00324362029))
* **logging:** remappable console log levels ([#179](https://github.com/khromov/mochi/issues/179)) ([b559717](https://github.com/khromov/mochi/commit/b5597172918b121f0bc383b2c27b005b9992959c))
* named image sizes — defer all image transforms to the endpoint, captcha ([#144](https://github.com/khromov/mochi/issues/144)) ([e733500](https://github.com/khromov/mochi/commit/e733500255f3ab14d278e72fc8c2d06e2195549e))
* per-route and global rate limiting via @joint-ops/hitlimit-bun ([#157](https://github.com/khromov/mochi/issues/157)) ([8a51dfd](https://github.com/khromov/mochi/commit/8a51dfdd14d0972a81980ccc743d3a57bab52426))
* precompile server islands into the build manifest ([#132](https://github.com/khromov/mochi/issues/132)) ([a89cce2](https://github.com/khromov/mochi/commit/a89cce20027b8e733a4592cc6acdd010fb9fa79b))
* Reword docs and improve trailingSlash ([#116](https://github.com/khromov/mochi/issues/116)) ([7ab4fa7](https://github.com/khromov/mochi/commit/7ab4fa7e079b05a44eead2301ed6421e951195c9))
* separate dev build cache from production .mochi output ([#130](https://github.com/khromov/mochi/issues/130)) ([1b5f4f6](https://github.com/khromov/mochi/commit/1b5f4f61977a01709a13fe5a3aea4eec09091b31))
* **support:** store submissions, queue email, add admin inbox ([#174](https://github.com/khromov/mochi/issues/174)) ([a47a9d0](https://github.com/khromov/mochi/commit/a47a9d00a7b5c6efe028afaa765837bfe640f74a))
* warn on large barrel imports ([#131](https://github.com/khromov/mochi/issues/131)) ([1d1b36c](https://github.com/khromov/mochi/commit/1d1b36c81244234c8303cdf260ea13d32fe631db))


### Bug Fixes

* always reconnect the dev live-reload socket ([#178](https://github.com/khromov/mochi/issues/178)) ([ebcf467](https://github.com/khromov/mochi/commit/ebcf4677c345cf1052543e1f4d3ced86bdf977dd))
* avoid HTMLRewriter onEndTag request-context leak ([#155](https://github.com/khromov/mochi/issues/155)) ([be5e15e](https://github.com/khromov/mochi/commit/be5e15e899451977bad6a4bf31f53538c169e12a))
* **deps:** update dependencies across the monorepo ([#189](https://github.com/khromov/mochi/issues/189)) ([f220ec5](https://github.com/khromov/mochi/commit/f220ec51f77f2952eafa1bf04075b3fcda3fb63e))
* force-close connections on shutdown so the process actually exits ([#176](https://github.com/khromov/mochi/issues/176)) ([16c3b2f](https://github.com/khromov/mochi/commit/16c3b2fc64a0307d87d44a6cfa008dbdc140cec0))
* forward-slash paths in user-facing output on windows ([#163](https://github.com/khromov/mochi/issues/163)) ([98f05a8](https://github.com/khromov/mochi/commit/98f05a895ee51d8385e26cbbb4ff6dcca36c6cc5))
* fully transpile `<script lang="ts">` in .svelte with Bun ([#128](https://github.com/khromov/mochi/issues/128)) ([d4b9ea0](https://github.com/khromov/mochi/commit/d4b9ea088ba5b9fb949447b4588ce933a3d0f3c7))
* **logger:** make queue added/completed lines visible at the production log level ([#184](https://github.com/khromov/mochi/issues/184)) ([86ddcb4](https://github.com/khromov/mochi/commit/86ddcb497d5a3c01f81aa03dfa75d634139422c6))
* make unresolvable island directives a compile error ([#160](https://github.com/khromov/mochi/issues/160)) ([bef2d60](https://github.com/khromov/mochi/commit/bef2d6074161958b6273a139d92d79c83fcc432f))
* nested islands support — inject CSS for islands inside deferred content and deduplicate the debug bar ([#125](https://github.com/khromov/mochi/issues/125)) ([4044e87](https://github.com/khromov/mochi/commit/4044e87840a546bd58b62717cfabd2a7950af3a8))
* **queue:** stop falsely failing jobs that run longer than 30 seconds ([#188](https://github.com/khromov/mochi/issues/188)) ([32b5209](https://github.com/khromov/mochi/commit/32b5209cbecb273ed26a0204e872a70d840c4a81))
* resolve HTML validation warnings (lang, charset position, aria-label) ([#145](https://github.com/khromov/mochi/issues/145)) ([0b21eca](https://github.com/khromov/mochi/commit/0b21ecaaf7aa51e46a0e245b1003dbaceb4a3b9d))
* resolve validated bugs, security issues & dead code from framework review ([#137](https://github.com/khromov/mochi/issues/137)) ([373e31a](https://github.com/khromov/mochi/commit/373e31a596fc9e3f6f52952fadbcad298a7e6703))
* workaround eisdir testing bug ([#172](https://github.com/khromov/mochi/issues/172)) ([73b4db4](https://github.com/khromov/mochi/commit/73b4db483e3dff6326e04b93d1118751bf767806))


### Performance

* **build:** single client bundle, batched CSS minify, overlapped build steps ([#181](https://github.com/khromov/mochi/issues/181)) ([aac7ea2](https://github.com/khromov/mochi/commit/aac7ea226640337b64c40b301b6f1801a2d83cf0))
* extract mochi-env virtual modules to plain .js templates, decrease bundle by ~2kb for unused client side imports from mochi-framework ([#162](https://github.com/khromov/mochi/issues/162)) ([a5fd1a7](https://github.com/khromov/mochi/commit/a5fd1a712ced7ab357e91c8f05c145a7ae8e6b22))
* memoize per-serve() startup work in mochi framework ([#142](https://github.com/khromov/mochi/issues/142)) ([ef00dea](https://github.com/khromov/mochi/commit/ef00dea4ad2dea7d3c6eb72d4ff7cf6f7f1cf8ed))
* **mochi:** cache compiled component output to speed up dev HMR ([#122](https://github.com/khromov/mochi/issues/122)) ([91420f2](https://github.com/khromov/mochi/commit/91420f2f62913b95b54a020a4d72db68340974a5))


### Documentation

* serve doc screenshots through local image imports ([#186](https://github.com/khromov/mochi/issues/186)) ([b54fe8e](https://github.com/khromov/mochi/commit/b54fe8e58a88a0b9f9cadaf793f758654990020e))


### Code Refactoring

* core cleanup ([#134](https://github.com/khromov/mochi/issues/134)) ([133c26a](https://github.com/khromov/mochi/commit/133c26a7fd4d58e527e1fbee7f44e53ba22b8fb6))
* isolate email render via renderDetached primitive ([#149](https://github.com/khromov/mochi/issues/149)) ([8ac8aa6](https://github.com/khromov/mochi/commit/8ac8aa6d9d021188cb6b0739bcaaf7aae551aeaa))

## [0.7.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.6.0...mochi-framework-v0.7.0) (2026-06-16)


### Features

* add automatic HEAD request support for all route types ([#76](https://github.com/khromov/mochi/issues/76)) ([925ba6c](https://github.com/khromov/mochi/commit/925ba6cca27d92f8c007c251f0f2ebb0ea72953b))
* add official mcp server ([47acc11](https://github.com/khromov/mochi/commit/47acc11e7483ca3b81e3fe6d615d50931589b45c))
* add ViewTransitions and RawScript components (+ view-transitions & custom-transitions demos) ([#66](https://github.com/khromov/mochi/issues/66)) ([7402c28](https://github.com/khromov/mochi/commit/7402c281099feee8c659fd4a6946d0ab45e7af7e))
* configurable debug bar panels via cogwheel setting ([#87](https://github.com/khromov/mochi/issues/87)) ([b36e224](https://github.com/khromov/mochi/commit/b36e2248b7fde216f058945cc0fb23f8a216d6e1))
* Mochi skill ([#100](https://github.com/khromov/mochi/issues/100)) ([ae8fea5](https://github.com/khromov/mochi/commit/ae8fea510d7b900a71d26c15ebe6d5132148bd6d))
* replace islandId auto-prop with native $props.id(), remove nanoid dependency ([#96](https://github.com/khromov/mochi/issues/96)) ([e1236a5](https://github.com/khromov/mochi/commit/e1236a5bc31c5d1edf351c6f0d27bd4ae5e8ec60))


### Bug Fixes

* drop @types/negotiator runtime dep via local ambient declaration ([#88](https://github.com/khromov/mochi/issues/88)) ([773d2d0](https://github.com/khromov/mochi/commit/773d2d05cb0532755c20a98aa7221ea13e452ff6))
* mark shared island props blocks correctly, show actual prop content in debug bar instead of devalue format ([3cda6da](https://github.com/khromov/mochi/commit/3cda6da298b100274254795f4a0a517c82e71373))
* surface svelte-shaker failures and point users at its tracker ([#80](https://github.com/khromov/mochi/issues/80)) ([41fb9eb](https://github.com/khromov/mochi/commit/41fb9ebf6716e3563a0cfa9ce32c7a42ecd85d02))


### Code Refactoring

* replace $props&lt;T&gt;() with annotated let destructuring ([#91](https://github.com/khromov/mochi/issues/91)) ([0304446](https://github.com/khromov/mochi/commit/0304446271e48137b8f136200959fc0be2c8bdeb))
* replace stale-while-revalidate-cache with inline helper (remove 2 deps) ([#92](https://github.com/khromov/mochi/issues/92)) ([dd33f82](https://github.com/khromov/mochi/commit/dd33f820458556e6aecead8b48451d1ff0efbf00))

## [0.6.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.5.1...mochi-framework-v0.6.0) (2026-06-07)


### Features

* add svelte-shaker support and remove routes.ts convention in favor of single index.ts ([#74](https://github.com/khromov/mochi/issues/74)) ([ec4487f](https://github.com/khromov/mochi/commit/ec4487f4dedd75fd5e72be2b38054a4445342178))
* added a new "info" tab to debug bar showing runtime versions and mochi configuration ([a6a1792](https://github.com/khromov/mochi/commit/a6a1792252fd3ec2a063c7e834a9709be9cc26ff))


### Bug Fixes

* **mochi-framework:** various hmr edge case fixes ([ecb627d](https://github.com/khromov/mochi/commit/ecb627daaf75df8f8b39599b7889abc66a624876))
* trigger hmr when shell.html is edited ([#72](https://github.com/khromov/mochi/issues/72)) ([d519b89](https://github.com/khromov/mochi/commit/d519b891ca8d2dc39b4ce7e1e6c3970497f3ce22))
* various hmr edge case fixes ([79048e3](https://github.com/khromov/mochi/commit/79048e3cad8447882feac1362584c63becef75fb))

## [0.5.1](https://github.com/khromov/mochi/compare/mochi-framework-v0.5.0...mochi-framework-v0.5.1) (2026-06-04)


### Bug Fixes

* stray {{mochi.script}} text rendered on pages that mention the placeholder ([#67](https://github.com/khromov/mochi/issues/67)) ([38d3ee4](https://github.com/khromov/mochi/commit/38d3ee4a88660c8db728196b43abc74e02c42546))
* windows support ([8547194](https://github.com/khromov/mochi/commit/854719458680d306910eac12c3aa43feaf3e1f96))

## [0.5.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.4.0...mochi-framework-v0.5.0) (2026-05-28)


### Features

* hot-swap route handlers in dev mode ([#41](https://github.com/khromov/mochi/issues/41)) ([106a4a2](https://github.com/khromov/mochi/commit/106a4a2b4c2a763c6e571cfb13a9ae3d4a61d616))
* opt-in route warmup to pre-warm static pages at startup ([#64](https://github.com/khromov/mochi/issues/64)) ([9f28ede](https://github.com/khromov/mochi/commit/9f28ede42e606f55a78535673a863a779e3db0dd))
* replace highlight.js with Shiki ([#54](https://github.com/khromov/mochi/issues/54)) ([3d2dc6a](https://github.com/khromov/mochi/commit/3d2dc6ae3092f72fd74224770fdcc414bed1922c))


### Code Refactoring

* replace `cookie` npm package with Bun native cookie APIs ([#60](https://github.com/khromov/mochi/issues/60)) ([4e0d953](https://github.com/khromov/mochi/commit/4e0d953c9594eadec8eb047c4373186ed1779456))
* run all tests in per-file isolation, drop .isolated.test.ts suffix ([#55](https://github.com/khromov/mochi/issues/55)) ([68cdc06](https://github.com/khromov/mochi/commit/68cdc065f1ec901131dde40c7da677fefc35c849))
* vendor debounce, drop npm dependency ([#63](https://github.com/khromov/mochi/issues/63)) ([d465fea](https://github.com/khromov/mochi/commit/d465feafbd3bda4ae7657ae4ea6168d0af17cc5f))
* vendor json-format-highlight, drop npm dependency ([#61](https://github.com/khromov/mochi/issues/61)) ([0b88399](https://github.com/khromov/mochi/commit/0b883994a089b8beedfb2e0c703a544b495ce07c))

## [0.4.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.3.2...mochi-framework-v0.4.0) (2026-05-26)


### Features

* make url export isomorphic (server + client) ([#47](https://github.com/khromov/mochi/issues/47)) ([11bbbe6](https://github.com/khromov/mochi/commit/11bbbe6b4d500a7efa17ba7ebc053783a1dd7f5e))
* per-page JS bundle panel in debug bar ([#42](https://github.com/khromov/mochi/issues/42)) ([7eba984](https://github.com/khromov/mochi/commit/7eba9847727f9685566044c1c28ea84bb48704f9))


### Bug Fixes

* resolve Svelte 5 state warnings and add autofixer tooling ([#49](https://github.com/khromov/mochi/issues/49)) ([3d949a5](https://github.com/khromov/mochi/commit/3d949a5cd52592de268a57ae22de9d58a33d8163))


### Performance

* consolidate per-request HTML passes in renderComponent ([#36](https://github.com/khromov/mochi/issues/36)) ([285a87f](https://github.com/khromov/mochi/commit/285a87f3ea117d0b7147a1ec50d46be19dabd514))
* reduce server island runtime by ~80% (8.59kB → 1.91kB ) ([#50](https://github.com/khromov/mochi/issues/50)) ([d570bc8](https://github.com/khromov/mochi/commit/d570bc83e2e5f202b37f96e4c02f6f1267d86292))

## [0.3.2](https://github.com/khromov/mochi/compare/mochi-framework-v0.3.1...mochi-framework-v0.3.2) (2026-05-24)


### Bug Fixes

* register trailing-slash alternates for internal framework routes ([#33](https://github.com/khromov/mochi/issues/33)) ([453eac5](https://github.com/khromov/mochi/commit/453eac5358e39abba036dcede1e19e99b889f503))

## [0.3.1](https://github.com/khromov/mochi/compare/mochi-framework-v0.3.0...mochi-framework-v0.3.1) (2026-05-23)


### Bug Fixes

* debug bar Bundles link points to undefined in production ([#30](https://github.com/khromov/mochi/issues/30)) ([2c77825](https://github.com/khromov/mochi/commit/2c778256858254e617b3c1d7e3cadeddbe4827f4))
* immutable asset caching + feat: SSR duration in debug bar ([#32](https://github.com/khromov/mochi/issues/32)) ([0f8bb68](https://github.com/khromov/mochi/commit/0f8bb6804ccd8b150ba70c93941f38b7724fad84))

## [0.3.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.2.0...mochi-framework-v0.3.0) (2026-05-23)


### Features

* add liveReload option to disable dev WS ([#23](https://github.com/khromov/mochi/issues/23)) ([616ab7a](https://github.com/khromov/mochi/commit/616ab7ac95a8553b47ee7daed473b9745770a7b0))
* **mdsvex:** preprocess mochi:hydrate inside markdown files ([#22](https://github.com/khromov/mochi/issues/22)) ([bcf08e4](https://github.com/khromov/mochi/commit/bcf08e46f369255706e64164df67d04c1dad5e80))


### Bug Fixes

* **debug-bar:** show green status dot when liveReload is disabled ([#27](https://github.com/khromov/mochi/issues/27)) ([f8896f5](https://github.com/khromov/mochi/commit/f8896f53bc8fc3553efd5277e52e8421e468768f))

## [0.2.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.1.1...mochi-framework-v0.2.0) (2026-05-23)


### Features

* **debug-bar:** redesign + landing Quick Start + Discord links ([#16](https://github.com/khromov/mochi/issues/16)) ([91a0931](https://github.com/khromov/mochi/commit/91a09313abb310f8e5e71d5f5678e4bdbeb6980c))
* **docs:** first-app walkthrough, docker page, intro rewrite, Dockerfile cleanup ([#18](https://github.com/khromov/mochi/issues/18)) ([a0df099](https://github.com/khromov/mochi/commit/a0df0998c882f18fe1978ba7b388cfbd27c4768b))


### Performance

* **ssr:** cache and skip Svelte preprocessing for non-island sources ([#19](https://github.com/khromov/mochi/issues/19)) ([1bbbd79](https://github.com/khromov/mochi/commit/1bbbd79a870bde1c8a04b5fb0d69af5497740390))

## [0.1.1](https://github.com/khromov/mochi/compare/mochi-framework-v0.1.0...mochi-framework-v0.1.1) (2026-05-22)


### Bug Fixes

* typecheck errors in scaffolded `bun create mochi` projects ([#10](https://github.com/khromov/mochi/issues/10)) ([202ff53](https://github.com/khromov/mochi/commit/202ff531306140306a8990a2e47ba081195957c3))

## [0.1.0](https://github.com/khromov/mochi/compare/mochi-framework-v0.0.1...mochi-framework-v0.1.0) (2026-05-21)


### Features

* expose params and cookies on MochiApiEvent ([#1](https://github.com/khromov/mochi/issues/1)) ([8fc956d](https://github.com/khromov/mochi/commit/8fc956daaa0c293775f3386efe46748ec1a18f68))

## Changelog
