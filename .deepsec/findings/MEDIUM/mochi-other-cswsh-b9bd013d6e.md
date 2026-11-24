# [MEDIUM] Live-reload WebSocket upgrade performs no Origin check (cross-site WebSocket hijacking)

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L152-L179) (lines 152, 159, 176, 179)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-cswsh`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`liveReloadHandler` (L152-172) reads the URL for an `entry` query param and calls `srv.upgrade(req, { data })` without ever inspecting `Origin` — there is no `origin` reference anywhere in the file, and WebSocket handshakes are exempt from the same-origin policy and CORS preflight, so any web page in any tab can open this socket against a reachable Mochi dev server.

What a connected attacker receives: the `boot:<BOOT_ID>:<generation>` greeting (Mochi.ts:1958-1962), every `reload` broadcast the watcher sends (L176-193) — a live side channel revealing when the developer saves a file and, via the per-entry scoping, which page they are editing — and `email:new:<id>` for every message the dev outbox captures (Mochi.ts:1979-1986), i.e. the id of every email the application 'sends', plus the fact and timing of each send. A malicious page can also keep unbounded sockets open here with no rate limit (see the related finding). Because the handler sets `__mochiRoutePattern` itself, the attacker cannot reach other ws handlers, and the `message` handler only answers `ping`, so the socket is read-mostly — the impact is activity/metadata disclosure rather than command execution.

This is reachable two ways: through the developer's own browser while they visit a hostile page with a dev server running on localhost (the classic CSWSH path, which no network boundary stops), and directly from any internet host against the dev-mode deployed sites, where the route exists despite `liveReload: false`.

## Recommendation

Validate the handshake before upgrading: compare `req.headers.get('Origin')` against `resolveExpectedOrigin(req, url, options.proxy)` and return 403 on a mismatch or a missing Origin (browsers always send one for WS). The framework already has that helper in `runtime/proxy.ts`, so it also handles the reverse-proxy case correctly.

## Revalidation

**Verdict:** true-positive

Confirmed by reading the whole file: `liveReloadHandler` (L152-172) reads `?entry`, builds `MochiWsData` and calls `srv.upgrade(req, { data })` with no reference to `Origin` anywhere in devWatcher.ts, and WebSocket handshakes are exempt from SOP and CORS preflight. This is not a speculative class — Bun's own documentation for `Bun.serve` WebSockets states it outright: 'The same-origin policy doesn't apply to WebSocket handshakes… Check the `Origin` header against an allowlist before calling `server.upgrade()`', and the framework already has `resolveExpectedOrigin`/`buildPublicUrl` in `runtime/proxy.ts` (the handler even calls `buildPublicUrl` two lines earlier). The realistic threat is the classic localhost path: a developer running `bun run dev` visits a hostile page, which opens a socket to `http://localhost:3333/__mochi_live_reload` and receives the `boot:<BOOT_ID>:<generation>` greeting (Mochi.ts:1958-1962, `liveReloadGreeting`), every `reload` broadcast, and `email:new:<id>` for each message the dev outbox captures (Mochi.ts:1979-1986). Because `notifyClients` filters on the client-supplied `__mochiEntry` against the resolved-path `affected` set, the attacker also gets a crude oracle for whether a specific absolute source path is being recompiled. Scope-limiting facts I verified and that keep this from being worse: the handler pins `__mochiRoutePattern` itself so no other ws handler is reachable, the `message` handler only answers `ping`, and on the internet-facing dev-mode deployments `liveReload: false` means `open` never runs, so the socket is never added to `liveReloadClients` and the cross-origin attacker receives nothing at all there. So the disclosure is file-save timing plus email ids on a developer's machine — low value, but a genuine missing-Origin-check on a WS upgrade with a trivial fix, and MEDIUM is the floor available for a security finding.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
