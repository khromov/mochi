---
title: 'Email'
slug: email
description: 'Send transactional email with Mochi.email() — SMTP, a custom-send escape hatch, or Svelte templates rendered to inlined HTML.'
---

<script>
  import Callout from './_components/Callout.svelte';
</script>

## Email

Send transactional mail — password resets, verification links, notifications — with `Mochi.email()`. Configure a **transport** once under `Mochi.serve({ email })`, then send from anywhere on the server: a page action, an API route, or a queue job.

```ts
import { Mochi } from 'mochi-framework';

await Mochi.serve({
  routes: {/* … */},
  email: {
    from: 'noreply@acme.dev',
    transport: { type: 'smtp', host: 'smtp.acme.dev', port: 587, auth: { user, pass } },
  },
});

// from an action, API handler, queue job — anywhere server-side:
await Mochi.email({
  to: 'alice@example.com',
  subject: 'Reset your password',
  html: '<p>Click <a href="…">here</a> to reset.</p>',
});
```

<Callout type="warning">

With **no transport configured**, `Mochi.email()` defaults to the **dev** transport in development (captured to an in-memory viewer, never sent) and the **log** transport in production (logged, never sent). Neither delivers — configure a real transport before relying on delivery.

</Callout>

### The message

```ts
await Mochi.email({
  to: 'alice@example.com', // string or string[]
  from: 'noreply@acme.dev', // optional — falls back to email.from
  cc,
  bcc,
  replyTo, // optional
  subject: 'Welcome',
  html: '<h1>Hi</h1>', // one of html / text / component
  text: 'Hi', // auto-derived from html when omitted
  attachments: [{ filename: 'invoice.pdf', content: bytes }],
  headers: { 'X-Entity': 'signup' },
});
```

`Mochi.email()` resolves the body (rendering `component` if given, deriving a plain-text part from HTML), fills `from` from `email.from`, normalizes recipients, sends, and resolves to a `MochiEmailResult` (`{ transport, messageId?, accepted?, rejected? }`).

### Transports

Set `email.transport` to one of four shapes. Omit it for the environment default: **dev** in development, **log** in production.

**SMTP** — delivers over SMTP via [nodemailer](https://nodemailer.com/):

```ts
email: {
  from: 'noreply@acme.dev',
  transport: {
    type: 'smtp',
    host: 'smtp.acme.dev',
    port: 587,            // default 465 when secure, else 587
    secure: false,       // default: port === 465
    auth: { user: '…', pass: '…' },
    pool: true,          // reuse a pooled connection
  },
}
```

**Custom** — an escape hatch for any HTTP email API (Resend, SES, Postmark, …) with no SDK. Receives the fully resolved message; no SMTP library is loaded:

```ts
email: {
  from: 'noreply@acme.dev',
  transport: {
    type: 'custom',
    send: async (msg) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, html: msg.html }),
      });
      const { id } = await res.json();
      return { messageId: id };
    },
  },
}
```

**Dev** (default in development) — sends nothing, but captures each message into an in-memory outbox you can browse. Used automatically in dev when `transport` is unset; set it explicitly with `{ type: 'dev' }`:

```ts
email: { from: 'noreply@acme.dev', transport: { type: 'dev' } }
```

**Log** (default in production) — logs a one-line summary and sends nothing. Used automatically in production when `transport` is unset; set it explicitly with `{ type: 'log' }`.

### The dev outbox

The `dev` transport stores every message in the running dev-server process and serves a viewer at **`/_mochi/email`** — a two-pane inbox that renders the exact HTML (in a sandboxed iframe), the plain-text alternative, the raw source, recipients, headers, and attachments. Each attachment is a link — click it to open the captured file inline in a new tab. When the `dev` transport is active, an envelope icon appears in the [debug bar](/docs/debug-bar/) linking straight to it.

<Callout type="info">

The outbox is **in-memory and dev-only**: it holds the most recent 100 messages, is wiped on restart, and the `/_mochi/email` route is not registered in production. It's for previewing mail during development — not a delivery log.

</Callout>

Because delivery should differ between environments, pick the transport dynamically. `NODE_ENV` is the reliable signal in a server entry (the `isDev` virtual is only available inside `.svelte`/compiled code):

```ts
await Mochi.serve({
  routes: {/* … */},
  email: {
    from: 'noreply@acme.dev',
    transport: process.env.NODE_ENV === 'production' ? { type: 'smtp', host: 'smtp.acme.dev', port: 587, auth: { user, pass } } : { type: 'dev' }, // captured to /_mochi/email
  },
});
```

Leaving `transport` unset gives you exactly this split automatically (`dev` in development, `log` in production).

### Svelte templates

Author an email body as a Svelte component instead of an HTML string. Pass its path as `component` (like `Mochi.page()`) plus `props`. Mochi SSR-renders it through the same pipeline as your pages — no page shell, no client JS — and **inlines its scoped CSS** into `style=""` attributes (via [juice](https://github.com/Automattic/juice), loaded lazily) for email-client compatibility.

```svelte
<!-- ./src/emails/Welcome.svelte -->
<script lang="ts">
  let { name }: { name: string } = $props();
</script>

<div class="card"><h1>Welcome, {name}</h1></div>

<style>
  .card {
    padding: 24px;
  }
  h1 {
    color: #6b46c1;
  }
</style>
```

```ts
await Mochi.email({
  to: 'alice@example.com',
  subject: 'Welcome to Acme',
  component: './src/emails/Welcome.svelte',
  props: { name: 'Alice' },
});
```

<Callout type="info">

Email templates render **outside an HTTP request** when sent from a background job, so they must not use request-context APIs (`getRequestContext`, `cookies`, `url`). Sent from within a route action, the request context is already active.

</Callout>

### Intercepting messages

The [`email:message` filter](/docs/extensions/#emailmessage) is the interceptor seam for outgoing mail. It runs on the fully-resolved message right before the transport, and can rewrite it (audit BCC, `List-Unsubscribe` headers, a staging catch-all) or return `null` to suppress the send. Prefer it over a `custom` transport when you only need to touch the message, not take over delivery.

```ts
await Mochi.serve({
  filters: {
    'email:message': (message) => ({ ...message, bcc: [...(message.bcc ?? []), 'audit@app.dev'] }),
  },
  routes,
});
```

### Observability

Each send emits a `email:sent` event (`{ to, subject, transport, messageId?, duration }`); failures emit `email:error` (`{ to, subject, transport, error }`). A send vetoed by the `email:message` filter emits `email:sent` with `transport: 'suppressed'`. `consoleLogger()` formats all of them as `MAIL` lines. Subscribe to `mochiEvents` for custom metrics.

Log level follows the outcome: successful deliveries (`sent via smtp`, `captured → /_mochi/email`, `suppressed`) are **info**, so they show in development but stay quiet at the production default level of `warn`. The two "didn't actually deliver" cases — the `log` transport's `logged (not sent)` and any `email:error` `send failed` — are **warn**, so they surface in production.

### Keeping recipients and subjects out of logs

`MAIL` lines print the recipient addresses and the subject. Because `email:error` logs at `warn`, a failed send writes both to your production logs by default:

```
MAIL alice@example.com send failed (smtp) "Password reset" — Connection timeout
```

Both are PII. Set `email.logPii: false` to replace them with `<redacted>`:

```ts
await Mochi.serve({
  email: {
    from: 'noreply@acme.dev',
    transport: { type: 'smtp', host: 'smtp.acme.dev', port: 587, auth: { user, pass } },
    logPii: false, // redact recipients + subject from MAIL log lines
  },
  routes,
});
// MAIL <redacted> send failed (smtp) <redacted> — Connection timeout
```

The transport, error, and duration are still logged, so the lines stay useful for debugging. Any recipient address that leaks into a transport's error string (e.g. an SMTP `550 no such user …`) is scrubbed too.

<Callout type="info">

`logPii` only affects the `consoleLogger()` output. The `email:sent` / `email:error` events still carry the real `to` and `subject`, so your own `mochiEvents` subscribers (metrics, error tracking) get the full values.

</Callout>
