# [BUG] Unvalidated WebSocket frames are persisted into the replayed history and crash every client's parser

**File:** [`packages/site/src/demos/chat/routes.ts`](https://github.com/khromov/mochi/blob/main/packages/site/src/demos/chat/routes.ts#L48-L68) (lines 48, 56, 63, 68)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-unvalidated-ws-payload`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The server treats a chat frame as an opaque string: `message` checks only the byte length (L49) and that the frame is text (L53), then pushes it into the shared `history` buffer (L63) and rebroadcasts it verbatim (L68-69). It never validates that the payload is the JSON envelope the only client speaks. Every browser consumes it with a bare `JSON.parse(e.data)` and immediately dereferences `msg.text` / `msg.userId` with no try/catch (ChatWidget.svelte:52-55).

Attack: the upgrade is unauthenticated and has no Origin check (see the CSWSH finding), so any WS client — `websocat wss://<site>/ws/chat` — can send the text frame `boom` or `null`. `JSON.parse('boom')` throws SyntaxError and `JSON.parse('null').text` throws TypeError inside every connected browser's message listener. Crucially the poisoned frame is also *persisted*: `open` replays the whole history to each new connection (L43-45), so the exception recurs for every future visitor, not just those online at the time. At the demo's own limit of 20 messages / 10 s a single IP fills all 100 history slots in ~50 s, after which the public demo renders nothing but the hardcoded greeting and emits one uncaught console error per replayed entry for every visitor. Frames that parse but lack `text` (e.g. `"hi"`, `{"userId":"x"}`) are worse than errors — they render as silent empty bubbles that consume history slots.

No XSS here: Svelte escapes `{msg.text}`, so the impact is integrity/availability of the shared buffer rather than script injection.

## Recommendation

Validate and normalize server-side before storing: `JSON.parse` inside a try/catch, require `{ userId: string, text: string }` with a bounded `text` length, and `ws.close(1003, …)` (or silently drop) anything else so malformed input can never enter `history`. Store and broadcast the re-serialized canonical form rather than the raw frame, and additionally wrap the client-side `JSON.parse` in a try/catch so one bad frame can never break the listener.

## Revalidation

**Verdict:** true-positive

The mechanism is confirmed. `message` (routes.ts:47-70) checks only byte length (L49) and text-ness (L53), then pushes the raw frame into `history` (L63) and rebroadcasts it (L68-69); nothing validates the `{userId, text}` envelope. `open` (L41-46) replays every entry to each new socket, and ChatWidget.svelte:52-55 does a bare `JSON.parse(e.data)` then dereferences `msg.text`/`msg.userId` with no try/catch, so `boom` throws SyntaxError and `null` throws TypeError in every receiving browser. I verified there is no XSS: the template renders `{msg.text}` (escaped by Svelte, no `{@html}`). I am downgrading severity because two of the finding's impact claims overstate reality. First, an exception inside an `addEventListener` callback does not remove the listener or break the socket — subsequent valid frames still render, so there is no persistent 'parser crash', only one console error per bad frame. Second, the poisoning is not permanent: `history` is FIFO-bounded to 100 entries / 64 KB (L65-67), so garbage is evicted by ordinary traffic, and a process restart clears it. The net harm is therefore console noise plus blank bubbles occupying history slots on a public demo widget — a real missing-input-validation defect at a trust boundary the server is positioned to enforce (and the same class the maintainers already fixed for this file in #332/#347), but no confidentiality or meaningful integrity impact, so BUG rather than a security MEDIUM. The recommended fix (parse in try/catch, require a bounded `{userId, text}`, store and broadcast the canonical re-serialized form) is correct.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
