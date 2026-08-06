---
title: 'Email'
slug: email
description: 'Send transactional email with Mochi.email() over SMTP, a custom send function, or Svelte templates rendered to inlined HTML.'
---

<script>
  import { Image } from 'mochi-framework/image';
  import Callout from './_components/Callout.svelte';
  import emailOutbox from './images/email-outbox.png';
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

// from an action, API handler, or queue job:
await Mochi.email({
  to: 'alice@example.com',
  subject: 'Reset your password',
  html: '<p>Click <a href="…">here</a> to reset.</p>',
});
```

<Callout type="warning">

With no transport configured, `Mochi.email()` uses the **dev** transport in development (captured to an in-memory viewer) and the **log** transport in production (logged only). Neither delivers. Configure a real transport before relying on delivery.

</Callout>

### The message

Envelope fields, plus the body:

```ts
await Mochi.email({
  to: 'alice@example.com', // string or string[]
  from: 'noreply@acme.dev', // optional — falls back to email.from
  cc,
  bcc,
  replyTo,
  subject: 'Welcome',
  component: './src/emails/Welcome.svelte', // the body — see "The body"
  props: { name: 'Alice' },
  attachments: [{ filename: 'invoice.pdf', content: bytes }],
  headers: { 'X-Entity': 'signup' },
});
```

`Mochi.email()` resolves the body, fills `from` from `email.from`, normalizes recipients, sends, and resolves to a `MochiEmailResult` (`{ transport, messageId?, accepted?, rejected? }`).

Any address field accepts a display name in the standard `Name <addr>` form:

```ts
await Mochi.email({ from: 'Acme <noreply@acme.dev>', to: 'Alice <alice@example.com>', subject, text });
```

### The body

A message has two parts:

- **The HTML part** — an `html` string **or** a `component` (a Svelte template rendered to inlined HTML). If you pass both, `component` wins.
- **The text part** — the `text` string. Mochi derives it from the HTML when you omit it, so the message stays multipart.

```ts
// HTML + your own plain-text alternative (recommended):
await Mochi.email({ to, subject, html: '<h1>Hi</h1>', text: 'Hi' });

// A Svelte component + your own plain-text alternative:
await Mochi.email({ to, subject, component: './src/emails/Welcome.svelte', props: { name: 'Alice' }, text: 'Welcome, Alice' });

// HTML only — Mochi derives the text part:
await Mochi.email({ to, subject, html: '<h1>Hi</h1>' });

// Plain-text only:
await Mochi.email({ to, subject, text: 'Hi' });
```

Supply `text` yourself when you can. The auto-derived fallback strips tags from your HTML, so a hand-written version usually reads better.

### Transports

Set `email.transport` to one of four shapes. Omit it for the environment default: **dev** in development, **log** in production.

**SMTP** — delivers over SMTP through [nodemailer](https://nodemailer.com/):

```ts
email: {
  from: 'noreply@acme.dev',
  transport: {
    type: 'smtp',
    host: 'smtp.acme.dev',
    port: 587,            // default 465 when secure, else 587
    secure: false,       // default: port === 465
    auth: { user: '…', pass: '…' },
    pool: true,
  },
}
```

**Custom** — an escape hatch for any HTTP email API (Resend, SES, Postmark) with no SDK. Receives the resolved message. No SMTP library is loaded:

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

**Dev** (default in development) — captures each message into an in-memory outbox you can browse. Set it explicitly with `{ type: 'dev' }`.

**Log** (default in production) — logs a one-line summary. Set it explicitly with `{ type: 'log' }`.

### The dev outbox

The `dev` transport stores each message in the dev-server process and serves a viewer at **`/_mochi/email`**. The viewer renders the HTML in a sandboxed iframe, plus the plain-text part, the raw source, recipients, headers, and attachments. When the `dev` transport is active, an envelope icon in the [debug bar](/docs/debug-bar/) links to it.

<figure>
  <Image src={emailOutbox} size="doc" width={emailOutbox.width} height={emailOutbox.height} alt="The dev outbox: a list of four captured messages on the left, and on the right the selected message's from, to and date, an attachment chip, Preview / Text / Source tabs, and the rendered email body" />
  <figcaption>The outbox after sending four messages. The <code>Preview</code> / <code>Text</code> / <code>Source</code> tabs switch between the rendered HTML, the plain-text alternative, and the raw source.</figcaption>
</figure>

<Callout type="info">

The outbox is in-memory and dev-only. It holds the most recent 100 messages, is wiped on restart, and the `/_mochi/email` route is not registered in production.

</Callout>

Leaving `transport` unset gives you the dev/log split automatically. To pick the transport by hand, branch on `NODE_ENV` (the `isDev` constant is only available inside compiled code, not a server entry):

```ts
await Mochi.serve({
  routes: {/* … */},
  email: {
    from: 'noreply@acme.dev',
    transport: process.env.NODE_ENV === 'production' ? { type: 'smtp', host: 'smtp.acme.dev', port: 587, auth: { user, pass } } : { type: 'dev' },
  },
});
```

### Svelte templates

Author a body as a Svelte component. Pass its path as `component` (like `Mochi.page()`) plus `props`. Mochi renders it and **inlines its scoped CSS** into `style=""` attributes (via [css-inline](https://github.com/Stranger6667/css-inline)) for email-client compatibility.

Keep templates in **`src/emails/`**. `mochi-framework build` walks that directory and compiles every `.svelte` under it into the manifest, so production sends need neither the compiler nor your Svelte sources.

<Callout type="info">

A template outside `src/emails/` still renders, but the build cannot prebuild it. The first send in each process pays a full compile and logs a manifest-miss warning. Move it into `src/emails/` and rebuild.

</Callout>

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

Email templates always render outside the request context, even when sent from a route action. Request-context APIs (`getRequestContext`, `cookies`, `url`) throw. Pass everything the template needs through `props`.

</Callout>

<Callout type="danger">

**No islands in emails.** A `mochi:hydrate*` island or a `mochi:defer*` server island — anywhere in the template or in anything it imports — is a hard error. Email clients run no JavaScript. Render the content inline instead.

</Callout>

<Callout type="warning">

`<script>` tags in an email body are stripped during rendering. Email clients block scripts, so a script only bloats the message and trips spam filters. This applies to scripts you emit into the markup, for example through `<svelte:head>` or `{@html}`.

</Callout>

<Callout type="warning">

CSS inlining is best-effort, and email clients support only a limited, inconsistent subset of CSS. Rules that cannot inline (media queries, pseudo-classes) stay in a `<style>` block that some clients strip. Modern layout (flexbox/grid, custom properties) is unreliable. Favor simple, table- and inline-style-friendly markup, and test in the clients you care about.

</Callout>

### Sending in the background

Delivery is slow and can fail. Offload the send to a [`Mochi.queue()`](/docs/queues/) so the action returns immediately and a background worker runs `Mochi.email()` with retries.

```ts
// jobs.server.ts
import { Mochi } from 'mochi-framework';

export const emailQueue = Mochi.queue<{ to: string; name: string }>({
  concurrency: 5,
  defaultJobOptions: { attempts: 3 },
  process: async (job) => {
    await Mochi.email({
      to: job.data.to,
      subject: 'Welcome to Acme',
      component: './src/emails/Welcome.svelte',
      props: { name: job.data.name },
    });
  },
});
```

<Callout type="info">

A job runs outside an HTTP request, so the `process` function — and any Svelte template it renders — cannot reach `getRequestContext`, `cookies`, or `url`. Put everything the message needs into the job payload, which must be serializable.

</Callout>

### Intercepting messages

The [`email:message` filter](/docs/extensions/#emailmessage) runs on the fully-resolved message right before the transport. It can rewrite the message (audit BCC, `List-Unsubscribe` headers, a staging catch-all) or return `null` to suppress the send. Prefer it over a `custom` transport when you only need to touch the message.

```ts
await Mochi.serve({
  filters: {
    'email:message': (message) => ({ ...message, bcc: [...(message.bcc ?? []), 'audit@app.dev'] }),
  },
  routes,
});
```

### Observability

Each send emits `email:sent` (`{ to, subject, transport, messageId?, duration }`). Failures emit `email:error` (`{ to, subject, transport, error }`). A send vetoed by the `email:message` filter emits `email:sent` with `transport: 'suppressed'`. `consoleLogger()` formats them as `MAIL` lines. Successful deliveries log at `info`. The two "did not deliver" cases — the `log` transport and any `email:error` — log at `warn`.

### Keeping recipients and subjects out of logs

`MAIL` lines print recipients and the subject. Both are PII, so `email.filterPii` defaults to `true` in production (redacted) and `false` in development. Set it explicitly to override:

```ts
await Mochi.serve({
  email: {
    from: 'noreply@acme.dev',
    transport: { type: 'smtp', host: 'smtp.acme.dev', port: 587, auth: { user, pass } },
    filterPii: true, // redact recipients + subject from MAIL log lines
  },
  routes,
});
```

The transport, error, and duration are still logged, so the lines stay useful. `filterPii` affects `consoleLogger()` output only. The `email:sent` / `email:error` events still carry the real `to` and `subject`, so your own `mochiEvents` subscribers get the full values.
