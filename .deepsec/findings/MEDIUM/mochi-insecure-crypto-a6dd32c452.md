# [MEDIUM] SMTP transport cannot require TLS: opportunistic STARTTLS on the default port 587 leaks AUTH credentials and message bodies to a downgrade attacker

**File:** [`packages/mochi/src/email/transports.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/email/transports.ts#L103-L112) (lines 103, 104, 107, 112)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** high  •  **Slug:** `insecure-crypto`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

buildTransporter() destructures exactly six keys off the config — `const { host, port, secure, auth, pool, tls } = this.config` (L103) — and forwards only those to `nodemailer.createTransport` (L105-112). MochiSmtpConfig (types.ts:58-69) declares the same six. nodemailer's `requireTLS` therefore has no route into the connection: it is not a MochiSmtpConfig field, and a config object that carries it anyway (e.g. assembled dynamically, as packages/support/src/index.ts:22-29 does) has it silently dropped by the destructure. `tls` is not a substitute — nodemailer reads `options.requireTLS` at the connection level and passes `options.tls` to the TLS socket (smtp-connection/index.js:281, 1490, 1500).

When `secure` is unset the transport defaults to port 587 with `secure: false` (L104, L107), i.e. plain SMTP with opportunistic STARTTLS. Verified in node_modules/nodemailer/dist/esm/smtp-connection/index.js:1500: the upgrade is attempted only when the EHLO response advertises STARTTLS or `requireTLS` is set; otherwise `_parseEhloExtensions` runs and the session proceeds in cleartext, after which AUTH sends `auth.user`/`auth.pass` and the full message body unencrypted. An active network attacker (or a hostile/compromised relay) who strips the `250-STARTTLS` capability line from EHLO gets the SMTP account credentials and every outgoing message in the clear — the classic STARTTLS-stripping attack that `requireTLS` exists to prevent, with no configuration available to an app that wants to stop it.

This is not hypothetical for this repo: packages/support is the one deployed app with a real transport, it ships `SMTP_PORT=587` with `SMTP_USER`/`SMTP_PASSWORD` and a commented-out `SMTP_SECURE=false` in its .env.example, and the messages it carries are support submissions plus newsletter double-opt-in links. A workaround exists (port 465 + `secure: true`, implicit TLS, which nodemailer validates certificates for by default), but the framework's default for an authenticated submission-port transport is the downgradable one and there is no knob to harden it.

## Recommendation

Add `requireTLS?: boolean` (and optionally `ignoreTLS`/`opportunisticTLS`) to MochiSmtpConfig and forward it in buildTransporter. Default it to `true` whenever `secure` resolves to false and `auth` is present, so credentialed submission-port sends fail closed rather than falling back to cleartext; document port 465 + `secure: true` as the preferred configuration.

## Revalidation

**Verdict:** true-positive

This one checks out in full and is the most solidly verified of the four. `buildTransporter` (transports.ts:103) destructures exactly `{ host, port, secure, auth, pool, tls }` and forwards only those to `createTransport` (L105-112); `MochiSmtpConfig` (types.ts:58-69) declares the same six fields; and `grep -rn 'requireTLS|ignoreTLS|opportunisticTLS' packages/` returns nothing anywhere in the repo, so there is provably no route for nodemailer's `requireTLS` into the connection — a dynamically assembled config carrying it (the shape `packages/support/src/index.ts:22-29` uses) has it dropped by the destructure at runtime even if a cast got it past tsc. I confirmed the consequence in the installed nodemailer: `dist/esm/smtp-connection/index.js:1500` only issues STARTTLS when `!this.secure && !ignoreTLS && (/[ -]STARTTLS\b/im.test(str) || this.options.requireTLS)`; with STARTTLS absent from the EHLO response and `requireTLS` unset it falls straight through to `_parseEhloExtensions` and emits `connect`, after which AUTH and the message body go over the wire in cleartext. `tls` is not a substitute — nodemailer reads `options.requireTLS` at the connection level and hands `options.tls` to the TLS socket. The default path is the vulnerable one: `resolvedSecure = secure ?? port === 465` and `port ?? 587` (L104/L107), so an unspecified config is plain SMTP on the submission port with opportunistic STARTTLS. This is not theoretical for the repo: `packages/support/.env.example` ships `SMTP_PORT=587` with `SMTP_USER`/`SMTP_PASSWORD` and only a commented-out `SMTP_SECURE=false`, and `packages/docs/116-email.md` shows `port: 587, auth: { user, pass }` in all three of its SMTP examples (lines 25, 105-109, 159, 282) with no TLS-hardening guidance at all. The attack is the textbook STARTTLS-stripping MITM: an active on-path attacker or hostile relay deletes the `250-STARTTLS` capability line and harvests the SMTP account credentials plus every support submission and newsletter confirmation link. A workaround exists (port 465 + `secure: true`, or dropping to a `custom` transport), but the framework's shipped default for a credentialed submission-port transport is downgradable and an app has no knob to harden it — a genuine missing-security-control finding (CWE-319/CWE-757). MEDIUM is appropriate given the active-network-position requirement.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-30)
