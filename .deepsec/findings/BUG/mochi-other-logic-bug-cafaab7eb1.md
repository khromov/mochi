# [BUG] Event-driven SSE stream sends no heartbeat, so idle viewers are dropped by the 60s proxy read timeout and reconnect in a loop

**File:** [`packages/site/src/demos/queue/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/queue/routes.ts#L30-L41) (lines 30, 33, 41)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** low  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

This stream emits only when a queue event fires (L33-37), so a visitor reading the demo page without enqueuing anything receives zero bytes after the initial response headers. packages/site/src/index.ts L168-170 documents that nginx fronts this deployment with a 60s `proxy_read_timeout` — which is why the WebSocket config sets `idleTimeout: 30` specifically to keep keepalive pings landing inside it. SSE gets no equivalent: `KIND_POLICY.sse.timeout` is true so Bun's own per-request timeout is disabled (`server.timeout(req, 0)`), but that does nothing about the upstream proxy, and the framework emits no comment heartbeat or `retry:` field. Every idle viewer's stream is therefore dropped roughly every 60s; EventSource auto-reconnects after ~3s, producing continuous connect/drop churn, and each reconnect re-registers three global bus listeners whose cleanup depends on `cancel()` firing — compounding the leak described in the finding above. Contrast /sse/admin/stock in packages/demos, which pushes every 1.5s and so never idles out.

## Recommendation

Send an immediate snapshot on open and then a periodic keep-alive comfortably under the proxy's read timeout (e.g. `stream.send('', { event: 'ping' })` or a bare `:` comment frame every 20-30s), clearing the interval in the existing `stream.onClose` handler alongside the `mochiEvents.off` calls.

## Revalidation

**Verdict:** true-positive

The code side is fully verified. The handler sends nothing on open and only reacts to `queue:*` events, so a visitor who reads the page without enqueuing receives zero body bytes; `MochiSseStream.send` emits only `id:`/`event:`/`data:` lines, so the framework has no comment-heartbeat or `retry:` facility; and `KIND_POLICY.sse.timeout` drives `server.timeout(req, 0)`, so Bun will not time the request out either. The upstream premise rests on the project's own attestation at packages/site/src/index.ts L168-170 ('`idleTimeout` keeps Bun's keepalive pings landing inside nginx's 60s `proxy_read_timeout`, which would otherwise drop every idle tab') — nginx's `proxy_read_timeout` is a between-successive-reads timer, so a stream that emits nothing for 60s is exactly what it kills. The client is a plain `EventSource` (QueueWidget.svelte L22) with no `retry:` hint, so the browser auto-reconnects after its default delay, giving continuous ~60s connect/drop churn on an idle viewer plus a few seconds per cycle in which queue events are missed permanently (after hydration the stream is the only source of counter updates). Two caveats temper it: the nginx configuration is not in the repo, so that premise is author-attested rather than verified; and the 'compounding the leak' sub-claim does not hold — the proxy closing the upstream socket is a client abort from Bun's perspective, so `cancel()` fires and the three listeners are removed on each cycle. Net: a real robustness defect with low user-visible impact, which is what BUG already denotes. The suggested fix (initial snapshot plus a 20-30s keep-alive cleared in the existing `onClose`) matches what `/sse/admin/stock` gets for free by pushing every 1.5s.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
