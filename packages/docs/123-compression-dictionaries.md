---
title: 'Compression dictionaries'
slug: compression-dictionaries
description: 'RFC 9842 compression dictionary transport: delta-compressed HTML navigations for returning visitors.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Compression dictionaries

Pages on a site share most of their markup — shell, nav, footer. [Compression dictionary transport (RFC 9842)](https://www.rfc-editor.org/rfc/rfc9842) lets the browser reuse that shared markup as a compression dictionary, so each navigation downloads only a small delta. Opt in on `Mochi.serve()`:

```ts
await Mochi.serve({
  routes,
  dictionary: true,
});
```

At boot, Mochi renders the configured routes (default: `/`) and installs the HTML as a raw dictionary:

- The dictionary is served at `/_mochi/dictionary` with `Use-As-Dictionary: match="/*", match-dest=("document")`.
- Every HTML page response advertises it via `Link: </_mochi/dictionary>; rel="compression-dictionary"` and `Vary: Accept-Encoding, Available-Dictionary`.
- When a request arrives with a matching `Available-Dictionary` hash and `dcz` in `Accept-Encoding`, the page is delta-compressed as dictionary-compressed Zstandard (`Content-Encoding: dcz`).

Everything is negotiated per request: browsers without the dictionary (or without `dcz` support) get your normal [`compress()`](/docs/middleware/) encoding. The feature is production-only — in development it is fully inert. Browsers only engage it in secure contexts (HTTPS or localhost).

### Options

Pass an object instead of `true` to tune it:

```ts
dictionary: {
  routes: ['/', '/docs'],
  maxAge: 3600,
}
```

| Option      | Default        |                                                                          |
| ----------- | -------------- | ------------------------------------------------------------------------ |
| `routes`    | `['/']`        | Static page routes rendered at boot and concatenated into the dictionary |
| `match`     | `'/*'`         | `Use-As-Dictionary` URLPattern for which requests the dictionary covers  |
| `matchDest` | `['document']` | Request destinations; `[]` omits the field (matches all destinations)    |
| `id`        | —              | Server id clients echo back as `Dictionary-ID`                           |
| `maxAge`    | `86400`        | `Cache-Control` max-age (seconds) of the dictionary response             |
| `level`     | `10`           | Zstandard level for `dcz` responses                                      |
| `maxBytes`  | 1 MiB          | Dictionary size cap; routes that would exceed it are skipped             |

Routes with `:param` or `*` segments can't be rendered at boot and are skipped with a warning.

### Deploys

The dictionary hash changes whenever the rendered HTML changes. After a deploy, returning visitors advertise a stale hash, get normal compression, and refetch the dictionary once their cached copy expires (`maxAge`) — so a shorter `maxAge` recovers delta compression faster at the cost of more dictionary refetches.

<Callout type="danger">

Dictionary compression has the same theoretical risk profile as any HTTP compression of mixed content (BREACH-style side channels): if a page reflects per-user secrets **and** attacker-controlled input, response sizes can leak information. Mochi never delta-compresses a response that sets cookies, but if your pages embed per-user secrets alongside user-supplied content, leave `dictionary` off for those routes (scope `match` accordingly) or entirely.

</Callout>

A `dictionary:ready` [event](/docs/events/) fires once the boot-time render completes, with the route count, dictionary size, hash, and duration.
