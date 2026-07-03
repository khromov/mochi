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

With **no transport configured**, `Mochi.email()` uses the default **log** transport: it logs the message and **does not send**. Configure a transport before relying on delivery.

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

Set `email.transport` to one of three shapes. Omit it for the default `log` transport.

**SMTP** — delivers over SMTP via [nodemailer](https://nodemailer.com/) (loaded lazily, only when this transport sends):

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

**Log** (default) — logs a one-line summary and sends nothing. Used automatically when `transport` is unset; set it explicitly with `{ type: 'log' }`.

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

### Observability

Each send emits a `email:sent` event (`{ to, subject, transport, messageId?, duration }`); failures emit `email:error`. `consoleLogger()` formats both as `MAIL` lines. Subscribe to `mochiEvents` for custom metrics.
