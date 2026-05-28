# Changelog

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
