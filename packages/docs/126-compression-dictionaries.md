---
title: 'Compression Dictionaries'
slug: compression-dictionaries
description: 'Serve dcz-compressed HTML navigations with Compression Dictionary Transport (RFC 9842).'
---

<script>
  import Callout from './_components/Callout.svelte';
  import VersionNote from './_components/VersionNote.svelte';
</script>

## Compression Dictionaries

<VersionNote since="0.10.0" message="compressionDictionary was added in 0.10.0." />

[Compression Dictionary Transport](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Compression_dictionary_transport) (RFC 9842) lets the browser reuse a previously downloaded dictionary when decompressing responses. Mochi pages share most of their HTML — shell, navigation, layout — so with a dictionary built from your own pages, a navigation only transfers what's unique to it. Transfer sizes routinely drop by an order of magnitude.

```ts
Mochi.serve({
  compressionDictionary: true, // production only
});
```

At boot, Mochi renders your static page routes once and publishes the harvested HTML as a shared dictionary at `/_mochi/dictionary/<hash>`. Every HTML page advertises it with a `Link: </_mochi/dictionary/<hash>>; rel="compression-dictionary"` header. The browser downloads the dictionary during idle time; from the next navigation on it sends `Available-Dictionary`, and Mochi answers with `Content-Encoding: dcz` — the page zstd-compressed against the dictionary.

<Callout type="info">

Chromium 130+ only. Every other browser (and any client that doesn't present a matching `Available-Dictionary` hash) falls back to your regular `compress()` negotiation — responses carry `Vary: Accept-Encoding, Available-Dictionary`, so caches stay correct. Browsers require a secure context: HTTPS in production, while `localhost` works as-is.

</Callout>

### Options

Pass an object for per-mode control and tuning:

```ts
Mochi.serve({
  compressionDictionary: {
    enabledInProd: true,
    enabledInDev: true, // for local testing; the dictionary is built once at boot and does not track dev edits
    routes: ['/', '/docs'], // default: every static page route
    maxDictionaryBytes: 262144, // cap on the idle-time download (default 256 KB)
    zstdLevel: 10, // per-response dcz compression level
  },
});
```

Routes with `:param` or `*` segments have no single canonical URL, so they can't be rendered at boot and are skipped with a warning. A page that would push the dictionary past `maxDictionaryBytes` is skipped whole, so the dictionary never ends mid-markup.

A `dictionary:ready` event fires once the dictionary is published (see [Events](/docs/events/)).

### Deploys

The dictionary is served from a content-addressed URL with `Cache-Control: immutable`, so a deploy that changes your HTML changes the hash and the URL. A returning visitor advertises the previous deploy’s hash, which the new process no longer holds, so that one navigation falls back to your normal `compress()` encoding. The `Link` header on it already points at the new dictionary, so the browser idle-fetches it and the navigation after that is `dcz` again — the gap is a single request, not the lifetime of a cache entry.

### Which responses get `dcz`

Only `GET` page responses that return `200` with a `text/html` body, and only when the client explicitly lists `dcz` in `Accept-Encoding` — `Accept-Encoding: *` never selects it. Responses that set a cookie are served normally.

<Callout type="danger">

Dictionary compression carries the same risk profile as any HTTP compression of mixed content (BREACH-style side channels): if a page reflects per-user secrets **and** attacker-controlled input, response sizes can leak information. Mochi never delta-compresses a response that sets cookies, but if your pages embed per-user secrets alongside user-supplied content, leave `compressionDictionary` off.

</Callout>

<Callout type="warning">

If you set a `Content-Security-Policy`, the dictionary URL must be allowed by `connect-src` (or `default-src`).

</Callout>

### Serving your own dictionary

The navigation dictionary rides on a public API you can use directly — useful for delta-compressing your own hashed JS bundles. Register bytes in a `DictionaryStore`, serve them with a `Use-As-Dictionary` header, and match the `Available-Dictionary` hash clients send back:

```ts
import { DictionaryStore, formatUseAsDictionary } from 'mochi-framework';

const dictionaries = new DictionaryStore();
const entry = dictionaries.add(await Bun.file('./app.dictionary.bin').bytes());

Mochi.api(
  () =>
    new Response(entry.bytes, {
      headers: {
        'Use-As-Dictionary': formatUseAsDictionary({ match: '/app/*.js' }),
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    }),
);
```

`parseAvailableDictionary`, `parseDictionaryId` and `frameDcz` cover the request side and the `dcz` frame layout. `dcb` (dictionary brotli) is not offered: no server-side encoder exists for it, and `dcz` covers every browser that supports either.
