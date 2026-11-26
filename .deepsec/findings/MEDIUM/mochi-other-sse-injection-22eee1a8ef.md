# [MEDIUM] SSE frame builder splits only on `\n`, so a CR in `data` (or any newline in `id`/`event`) injects forged events into the stream

**File:** [`packages/mochi/src/Mochi.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/Mochi.ts#L1388-L1395) (lines 1388, 1389, 1392, 1395)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `other-sse-injection`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`MochiSseStream.send` (L1386-1405) builds the wire frame by interpolation: `frame += \`id: ${opts.id}\n\`` and `frame += \`event: ${opts.event}\n\`` are emitted with no validation at all, and the body is split on LF only — `for (const line of data.split('\n')) frame += \`data: ${line}\n\``.

The HTML server-sent-events spec splits the stream on CRLF, a lone LF, **or a lone CR**. A single `\r` in `data` therefore terminates the `data:` line, and `\r\r` produces a blank line, which dispatches the event and starts a new one. Sending `stream.send("hello\r\rdata: forged")` puts this on the wire:

    data: hello\r\rdata: forged\n\n

which the browser's EventSource parses as two complete events (`hello`, then `forged`). `id`/`event` are worse — a bare `\n` suffices there, letting an attacker set an arbitrary event type, inject `data:` lines, or control `Last-Event-ID` (which the client echoes back on reconnect).

Attack scenario: a notification or chat feed broadcasts over `Mochi.sse`, e.g. `stream.send(message.body)` or `stream.send(payload, { id: message.id })`. The docs (`110-server-sent-events.md`) advertise exactly this shape (`stream.send(JSON.stringify({ok:true}), { event: 'tick', id: '42' })`) with no sanitisation requirement. An attacker who posts a message containing `\r\r` injects forged events into **other** users' streams — spoofing server-authored event types the client dispatches on (e.g. a `logout`, `balance-update` or `redirect` handler), or desynchronising the client's event-id cursor. The split-on-`\n` code shows the author considered newline framing and simply missed CR.

## Recommendation

Split the body on the full SSE line-terminator set (`data.split(/\r\n|\r|\n/)`), and reject or strip CR/LF in `opts.id` and `opts.event` before interpolating them (per spec, `id` must not contain any newline or NUL at all — throw a clear framework error rather than silently emitting a broken frame). Add a test asserting that `send("a\rb")` produces two `data:` lines in one event rather than two events.

## Revalidation

**Verdict:** true-positive

Confirmed in `MochiSseStream.send` (Mochi.ts:1386-1405): `id` and `event` are interpolated with zero validation (`frame += `id: ${opts.id}\n``), and the body is split with `data.split('\n')` — LF only. The HTML spec's event-stream parser splits lines on CRLF, a lone LF, *or* a lone CR, so `send('hello\r\rdata: forged')` puts `data: hello\r\rdata: forged\n\n` on the wire, which EventSource parses as two dispatched events ('hello', then 'forged'); a bare `\n` in `id`/`event` is even cheaper and lets an attacker set an arbitrary event type or poison `Last-Event-ID`. Nothing downstream normalizes it: the string chunks go straight through `controller.enqueue` into `new Response(body)`. The framework owns the framing (it already splits on `\n`, so newline handling was considered and CR was simply missed) and docs/110-server-sent-events.md:39-44 documents `send(data, {event, id})` with no sanitization requirement, so this is squarely a framework defect rather than an app責任. Exploitation requires an app to pass attacker-influenced text into `send` — realistic for a chat/notification feed, and the mitigating detail is that the documented `JSON.stringify(...)` idiom escapes CR as `\\r`, so every in-repo SSE route (site/demos streams, queue, admin stock) is immune. Keeping MEDIUM: the primitive is real and the consequence when triggered (forged server-authored events in other users' streams) is meaningful.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-11-14)
