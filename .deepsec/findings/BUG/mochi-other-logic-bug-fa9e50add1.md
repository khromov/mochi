# [BUG] `hasSubscribers()` ignores mitt wildcard subscribers, so gated events are dropped for `on('*')` listeners

**File:** [`packages/mochi/src/events.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/events.ts#L532-L533) (lines 532, 533)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`hasSubscribers` only inspects `mochiEvents.all.get(name)`, but `mochiEvents` is a `mitt` emitter and its `Emitter` type (re-exported through `MochiEmitter`) includes the `on('*', handler)` overload; mitt stores those handlers under the `'*'` key and invokes them on every `emit`. So an app that subscribes once with `mochiEvents.on('*', ...)` — the natural way to build a generic log/metrics forwarder — reports `hasSubscribers('preprocess-cache:hit') === false`, and framework code that guards emission on it (compiler/preprocessCache.ts:22 and :32) never emits, leaving the wildcard subscriber permanently blind to those events while the public docs (docs/147-events.md:75) present `hasSubscribers` as the general way to gate expensive payloads. Impact today is limited to two dev-time compile-cache events, but it is a latent trap for every future `hasSubscribers`-gated emission.

## Recommendation

Count wildcard handlers too: `return ((mochiEvents.all.get(name)?.length ?? 0) + (mochiEvents.all.get('*')?.length ?? 0)) > 0;`, and add a test registering only `on('*')`.

## Revalidation

**Verdict:** true-positive

Confirmed against the installed dependency, not just by inference. `hasSubscribers` (events.ts:532-533) inspects only `mochiEvents.all.get(name)`, but mitt 3.0.1's minified source in node_modules/mitt/dist/mitt.mjs stores every handler — including wildcard ones — in the same `all` map (`on: function(t,e){var i=n.get(t);i?i.push(e):n.set(t,[e])}`) and its `emit` invokes `n.get("*")` handlers on every event. `MochiEmitter extends Emitter<MochiEventMap>`, which includes mitt's `on('*', handler)` overload, so an app subscribing once with `mochiEvents.on('*', …)` — the natural shape for a generic log/metrics forwarder — is reported as having no subscribers for any specific key. compiler/preprocessCache.ts:22 and :32 gate emission on exactly that check, so those two events are silently never emitted for a wildcard-only subscriber, while docs/147-events.md:73-81 presents `hasSubscribers` as the general way to gate expensive payloads. events.test.ts:148-167 only covers typed `.on(name, …)` registration, so nothing catches it. Impact today is limited to two dev-time compile-cache events, which matches the reported BUG severity; the latent trap for future gated emissions is the real reason to fix it, and the suggested one-line fix (also count `all.get('*')`) is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-22)
