# [MEDIUM] Caller-supplied message keys and attachment descriptors are forwarded verbatim into nodemailer sendMail (local file read / SSRF / raw MIME)

**File:** [`packages/mochi/src/email/mailer.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/email/mailer.ts#L101-L116) (lines 101, 102, 110, 116)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-option-injection`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

sendEmail() builds the resolved message with `const { component, props, ...passthrough } = message` (L101) and spreads `passthrough` into `resolved` (L102-110). Only `component` and `props` are stripped; every other key the caller put on the object survives, and attachment entries are never validated — `attachmentSize` is the only thing that ever touches them. SmtpTransport then does `transporter.sendMail({ ...message })` (transports.ts:129) under a comment asserting the fields 'map 1:1 onto nodemailer's sendMail options', which holds only for the declared keys.

nodemailer 10.5.0 honors far more than ResolvedEmailMessage declares. Verified in node_modules/nodemailer/dist/esm/mail-composer/index.js: `this.mail.raw` replaces the entire MIME message (L70-75); `attachments[].path` streams a local file (L174-177) and is auto-promoted to `href` when it matches /^https?:\/\//  (L164-166); `attachments[].href` fetches a URL (L179-181); `icalEvent` and `alternatives` accept the same path/href/raw triple (L219-263, L344-368). `envelope` likewise overrides the SMTP RCPT TO set.

Attack scenario: an app that forwards user-influenced message data — `Mochi.email(body as MochiEmailMessage)`, `Mochi.email({ ...body, from })`, or the plausible 'attach the files the user listed' pattern where `attachments` comes from `JSON.parse(body)` — hands the attacker the sink. `attachments: [{ filename: 'x.txt', path: '/app/.env' }]` mails MOCHI_KEY/SMTP_PASSWORD to an attacker-chosen recipient; `attachments: [{ path: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' }]` is an SSRF whose response is exfiltrated by email; `raw: '...'` yields full control of the emitted message. TypeScript is the only thing standing in the way, and it is absent for `any`-typed request bodies and for JS consumers (mochi publishes raw TS source).

Two details make this worse than a pure app-side mistake. First, the framework advertises this boundary as a normalization step ('the normalized fields are overridden, keeping the raw string/array union and an unfilled from away from any transport', L98-100), so callers reasonably assume the message is sanitized. Second, the behavior diverges by transport: `recordDevEmail` (devOutbox.ts:70) reads only `filename`/`contentType`/`content` and throws a TypeError in `attachmentSize` on a `{path}` attachment, so development testing surfaces a crash while production SMTP silently reads the file. The declared `headers: Record<string, string>` passthrough is the same class of issue, allowing display-level To/From spoofing in the rendered message.

## Recommendation

Construct the transport-bound object from an explicit allowlist instead of a rest-spread: pick only from/to/cc/bcc/replyTo/subject/html/text/attachments/headers off `message`. Normalize each attachment entry to `{ filename, content, contentType }` and reject (or drop) entries carrying `path`, `href`, or `raw`, plus any non-string/Uint8Array `content`. Optionally validate header names/values against a conservative pattern. Fix the stale comment at transports.ts:126-128, which documents an invariant the code does not enforce.

## Revalidation

**Verdict:** true-positive

I verified every code-level claim. `sendEmail()` at mailer.ts:101 destructures only `component`/`props` out and spreads the rest (`...passthrough`) into `resolved` (L102-110), and `SmtpTransport.deliver` at transports.ts:129 does `transporter.sendMail({ ...message })` with no filtering, so any key the caller put on the message object lands in nodemailer. I confirmed the sinks in the installed nodemailer 10.5.0: `dist/esm/mail-composer/index.js` L69-75 replaces the whole MIME tree from `this.mail.raw`; L164-166 promotes `attachment.path` to `href` when it matches `^https?://`; L174-181 streams `{path}` from the local filesystem or fetches `{href}`; and `disableFileAccess`/`disableUrlAccess` are read off `this.mail.*` only, i.e. they default to falsy, so file and URL access are both live. The runtime contract is therefore strictly wider than the declared types: `MochiEmailAttachment` makes `content` required, yet `recordDevEmail`'s `attachmentSize` (devOutbox.ts:49-51) throws a TypeError on a `{path}`-only entry — proving the runtime accepts what the type forbids, and confirming the finding's dev-vs-prod divergence (dev crashes loudly, SMTP silently reads the file). I could not name any runtime mitigation: TypeScript excess-property checking is the only barrier, it does not apply to a spread or to `JSON.parse(body) as MochiEmailMessage`, and mochi publishes raw TS so a JS consumer gets nothing. I checked every in-repo caller (`support/src/jobs.server.ts:32`, `support/src/newsletter/jobs.server.ts:50`, `site/src/demos/email/routes.ts:15,27`, the tests) and all build literal messages from server-controlled data, so there is no reachable path in this repository — this is a latent framework sink that needs a consumer-side mass-assignment bug to fire, which is why MEDIUM (not higher) is the right severity and I am leaving it unchanged. One nuance against the finding's framing: the L98-100 comment explicitly says author-supplied fields 'pass through untouched', so the 'callers assume it is sanitized' argument is weaker than claimed, but the stale transports.ts:126-128 comment ('map 1:1 onto nodemailer's sendMail options') genuinely asserts an invariant the rest-spread does not enforce. The recommendation is correct and cheap: allowlist the transport-bound keys and normalize each attachment to `{filename, content, contentType}`, rejecting `path`/`href`/`raw`.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
