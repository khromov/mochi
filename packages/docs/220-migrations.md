---
title: 'Migrations'
slug: migrations
description: 'Version-by-version upgrade notes for Mochi, newest first — including LLM prompts you can paste to migrate breaking changes automatically.'
---

## Migrations

Most releases need no migration. The versions below introduced a breaking change; each entry says what moved and, where a change is mechanical, gives a prompt you can paste into your coding LLM to do the edit across your codebase.

### 0.10.0 — background jobs

Background work moved from bunqueue to [queuert](jobs). `Mochi.queue()`, `Mochi.getQueue()`, and the `Mochi.serve({ queues })` option are removed in favor of `Mochi.jobs()` and `Mochi.serve({ jobs })`. The five `queue:*` [events](events) keep their names, so observability code is unaffected.

Paste this into your LLM to migrate an existing app:

```
Migrate this Mochi app from the pre-0.10.0 background-queue API (bunqueue-backed `Mochi.queue()`) to the 0.10.0 job-chain API (queuert-backed `Mochi.jobs()`). Apply these changes across the codebase and preserve behavior and types:

1. Replace each `Mochi.queue<T>({ concurrency, process, on, recover, defaultJobOptions, lockDuration, dataPath, bunqueue })` descriptor with one `Mochi.jobs({ backend, types, processors, concurrency, retry, leaseMs })` descriptor. Import `defineJobTypes` from `mochi-framework`. There is ONE jobs runtime per app: merge every queue you had into a single `types`/`processors` map.

2. Declare each job name you passed to `.add(name, data)` as a type: `types: defineJobTypes<{ 'name': { entry: true; input: <DataType>; output: <ReturnType> } }>()`. `job.data` becomes `job.input`. For multi-step work, give the first step `continueWith: { typeName: 'next' }` in its type and have its handler call `continueWith({ typeName: 'next', input })`.

3. Convert each `process: async (job) => R` into `processors: { 'name': { attemptHandler: async ({ job, complete }) => complete(async () => R) } }`. The handler must return `complete(async () => output)` (or `complete(async ({ continueWith }) => continueWith(...))`) — it does NOT return the value directly.

4. Replace `Mochi.serve({ queues: { name: q } })` with `Mochi.serve({ jobs })`, passing the single `Mochi.jobs()` descriptor. Export that descriptor from its module and call methods on it directly.

5. Replace `Mochi.getQueue<T>(name).add(jobName, data, opts)` with `jobs.startChain({ typeName: jobName, input: data })` on the exported descriptor. `addBulk` becomes a loop of `startChain`, or `jobs.client().startChains(...)`.

6. Pick a backend. In-memory is the default and matches an old in-memory queue. For persistence use `backend: { kind: 'sqlite', path: '.db/jobs.sqlite' }` or `{ kind: 'postgres', url: process.env.DATABASE_URL }` instead of the old `dataPath`.

7. Delete every `recover()` callback. Durable backends keep pending work across restarts on their own. If a domain write and its job must commit together, wrap them in `jobs.withTransaction(async ({ tx, transactionHooks }) => { /* domain write on the same DB handle */ await jobs.startChain({ typeName, input, tx, transactionHooks }); })`.

8. Map the remaining options: `bunqueue.backoff` → `retry: { initialDelayMs, maxDelayMs, multiplier }`; `lockDuration` → `leaseMs`; `defaultJobOptions.attempts` + a last-attempt check → complete with a failure-shaped output once `job.attempt` crosses your threshold (queuert retries a throwing handler indefinitely by default). Move any per-queue `on` listeners to `mochiEvents.on('queue:completed' | 'queue:failed' | ...)` — the event names and payload fields are unchanged.

9. Remove any `msgpackr` / `msgpackr-extract` entries from your `package.json` `overrides` — bunqueue is gone, so nothing pulls them.

After migrating, run the type-checker and the test suite.
```

See [Background jobs](jobs) for the full API.
