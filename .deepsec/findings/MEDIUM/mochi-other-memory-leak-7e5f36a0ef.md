# [MEDIUM] MCP HttpTransport mounted with default in-memory session managers on a public route: every initialize permanently retains attacker data

**File:** [`packages/site/src/lib/mcp.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/lib/mcp.ts#L89) (lines 89)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-memory-leak`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

L89 constructs `new HttpTransport(mcpServer, { path: null, disableSse: true })`, leaving `sessionManager` at its default `InMemoryInfoSessionManager`. In that class (node_modules/@tmcp/session-manager/src/index.js) `#client_info`, `#client_capabilities`, `#log_level` and `#subscriptions` are plain `Map`s with no TTL, no cap, and no sweep — entries are removed only by an explicit HTTP DELETE for that exact session id.

The session id is `request.headers.get('mcp-session-id') || this.#options.getSessionId()` (transport respond()), i.e. fully client-supplied or, when the header is absent, a fresh random UUID per request. The transport's `initialize` listener then calls `setClientCapabilities(sessionId, ...)` and `setClientInfo(sessionId, clientInfo)` for every initialize it sees, where `clientInfo`/`capabilities` are attacker-supplied JSON (tmcp validates shape, not string length).

So each unauthenticated `initialize` POST to `/mcp` — or each POST carrying a new made-up `mcp-session-id` — permanently adds entries to three process-lifetime maps, with attacker-chosen content. With no rate limit on the route this is a steady, trivially scripted heap leak distinct from the amplification issue above: it survives even if the `sections` array is bounded.

## Recommendation

Pass an explicit bounded/TTL session manager (or a no-op info manager, since neither tool uses session state), and rate-limit `/mcp`. A cap keyed on session count with LRU eviction is enough; also consider rejecting client-supplied `mcp-session-id` values that the server never issued.

## Revalidation

**Verdict:** true-positive

Confirmed against the installed library source, and it is a genuinely distinct defect from F1 (different line, different mechanism, survives any fix to the `sections` bound). mcp.ts:89 passes only `{ path: null, disableSse: true }`, and HttpTransport's constructor destructuring (node_modules/@tmcp/transport-http/src/index.js:90-105) therefore defaults `sessionManager` to `{ streams: new InMemoryStreamSessionManager(), info: new InMemoryInfoSessionManager() }`. In `InMemoryInfoSessionManager` (node_modules/@tmcp/session-manager/src/index.js) `#client_info` and `#client_capabilities` are plain `Map`s with no cap, no TTL and no sweep; the only removal path is `delete(id)`, reached solely from the transport's `#handle_delete` on an explicit HTTP DELETE naming that exact session id. The session id is `request.headers.get('mcp-session-id') || getSessionId()`, i.e. attacker-supplied or a fresh `crypto.randomUUID()` per request (transport respond(), L554-556), and the transport's own `initialize` listener (L127-138) unconditionally calls `setClientCapabilities(sessionId, capabilities)` and `setClientInfo(sessionId, clientInfo)`. The stored content is attacker-chosen and unbounded: `ClientCapabilitiesSchema` is a valibot **`looseObject`** (validation/index.js:242), so arbitrary extra keys and megabyte-long values are preserved verbatim into the map, and `ImplementationSchema`'s `name`/`version`/`title`/`websiteUrl` are bare `v.string()` with no length limit. Combined with the absence of any rate limit on `/mcp` (verified as in F1) and no configured `maxRequestBodySize`, a scripted loop of `initialize` POSTs grows the heap monotonically for the process lifetime. Two small inaccuracies that do not change the verdict: `#log_level` is not reachable (`#init_logging` returns early because the server declares only `capabilities: { tools: { listChanged: false } }`, so `logging/setLevel` is never registered), and `#subscriptions` needs a resources capability that is likewise absent — so two of the four named maps leak, not four. The attacker must also supply a well-formed `protocolVersion`, which is trivial.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-16)
