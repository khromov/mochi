---
name: add-event
description: Add a new lifecycle event to Mochi's event bus (`packages/mochi/src/events.ts`). Use when the user asks to "add an event", "emit a new event", "create a new mochiEvents emission", or "/add-event <name>". Walks the payload type, the `MochiEventMap` registry, the emission site, public exports, optional logger wiring, tests, and docs.
user-invocable: true
---

# Add a Mochi event

Mochi emits lifecycle events through `mochiEvents` — a typed [`mitt`](https://www.npmjs.com/package/mitt) emitter pinned on `globalThis` so every bundled copy of the framework shares one instance. Adding a new event touches:

1. The payload type + `MochiEventMap` entry in `packages/mochi/src/events.ts`.
2. The emission site (`Mochi.ts`, `cache.ts`, `ComponentRegistry.ts`, or wherever the trigger lives).
3. Public re-exports in `packages/mochi/src/index.ts`.
4. (Optional) a log line in `packages/mochi/src/dev/consoleLogger.ts` if `consoleLogger()` should print it.
5. A test in `packages/mochi/src/events.test.ts` (and a behavioural test alongside the consumer if the emission has non-trivial logic).
6. Docs in `packages/docs/147-events.md`.

## Naming

- Format: `namespace:camelCase`. Mirrors hooks/filters in `extensions.ts`.
- Existing namespaces:
  - `request` — single, no namespace (HTTP request lifecycle).
  - `ws:` — WebSocket lifecycle (`ws:open`, `ws:message`, `ws:close`).
  - `sse:` — SSE lifecycle (`sse:open`, `sse:message`, `sse:close`).
  - `cache:` — `MochiCache` operations (`cache:read`, `cache:revalidate`).
  - `island:` — island errors (`island:error`).
  - `file:` — dev file watcher (`file:change`).
- Pick an existing namespace if one fits; introduce a new one only when none applies.
- Names are global — one entry per name across the whole framework.

## Events vs hooks/filters

Events are fire-and-forget observability. Handlers return `void`, run after the framework has used the data, and can't influence behaviour.

- If the user wants to **modify a value**, they want a filter (`/add-extension`), not an event.
- If the user wants the framework to **await user code** before continuing, that's a hook (`/add-extension`), not an event — even if the call site sounds event-like.
- If neither applies, an event is the right fit: emit, move on.

## Steps

1. **Decide the emission site first.** Open the file (`Mochi.ts`, `cache.ts`, `ComponentRegistry.ts`, or wherever the trigger is) and find the exact line. Emit _after_ the action it describes so handlers see the final state. The emission site decides the namespace, the payload shape, and whether you need an `isDev` gate.

2. **Add the payload interface and map entry** in `packages/mochi/src/events.ts`:

   ```ts
   export interface MochiThingHappenedEvent {
     path: string;
     duration: number;
     // …only primitive-ish fields. Don't expose framework internals or live references.
   }

   export type MochiEventMap = {
     // …existing entries
     'thing:happened': MochiThingHappenedEvent;
   };
   ```

   - Use `interface` for object payloads, `type` aliases for unions used as fields (mirror `MochiFileChangeType`, `MochiCacheStatus`).
   - Field names should match conventions of sibling events (`path`, `duration`, `status`, `size`).
   - Document dev-only or non-obvious fields with `/** … */` JSDoc, mirroring `MochiFileChangeEvent` and `MochiIslandErrorEvent.stack`.

3. **Re-export the payload type** (and any new sub-type aliases) from `packages/mochi/src/index.ts`. Add to the existing `export type { … } from './events';` block — keep alphabetical or grouping consistent with what's already there.

4. **Wire the emission site:**

   ```ts
   import { mochiEvents } from './events';

   mochiEvents.emit('thing:happened', {
     path,
     duration: performance.now() - startedAt,
   });
   ```

   - `emit` is sync and never throws (mitt swallows handler errors).
   - Construct the payload cheaply — every emission walks every subscriber.
   - Don't emit inside hot per-frame loops without sampling.

5. **Subscribe in `consoleLogger.ts`** _only if_ the event should appear in the default log stream. Match the existing pattern:

   ```ts
   mochiEvents.on('thing:happened', ({ path, duration }) => {
     emit({ label: 'THING', path, note: pc.cyan('happened'), duration, slow, verySlow });
   });
   ```

   - Use a 4-character `label` for column alignment with existing labels (`WS  `, `SSE `, `CACHE`).
   - For dev-only events, the emission site (not `consoleLogger.ts`) should be the `isDev` gate — `consoleLogger.ts` just prints what it receives.
   - Skip this step if the event is purely for userland observability.

6. **Test** in `packages/mochi/src/events.test.ts`:
   - Round-trip `emit` → `on` handler receives the payload (mirror the existing `roundtrip emit/subscribe works` test).
   - For TypeScript verification, the round-trip already proves the key is in `MochiEventMap`; no separate type-level test needed.

   If the emission site has logic worth verifying (correct `duration`, `kind`, etc.), add a test alongside the consumer (e.g. `cache.test.ts`, the relevant `Mochi.ts` test file) that drives the real path and asserts on the emitted payload.

7. **Document** in `packages/docs/147-events.md`:
   - Add a bullet to the `Events:` index near the top with a `[#anchor]` link. Markdown auto-slugs `thing:happened` to `thinghappened` (colons stripped) — match that.
   - Add a section under `### Event reference` titled with the event name as a level-4 heading:

     ```md
     #### `thing:happened`
     ```

     Body should contain: a one-sentence "fires when…", a payload table (Field / Type / Notes), and a short `mochiEvents.on(...)` example.

   - Match the terse, code-first style of the existing entries.

## Verification

After every change, run:

```sh
bun run typecheck
bun run test
bun run format
bun run lint
```

If you wired `consoleLogger.ts`, smoke-test the log line: `bun run dev:site` (port 3333), trigger the action, confirm the line renders with the chosen label, then stop the server.

## Guardrails

- **Events are fire-and-forget.** Don't add return values, don't await handlers, don't read mutated payloads. If any of those are tempting, switch to a hook or filter via `/add-extension`.
- **Don't emit from the browser.** `ComponentRegistry.ts` injects a runtime warning if browser code reaches `mochiEvents.emit()`. Keep emissions on the server.
- **Don't restructure existing payload fields.** Removing or renaming a field is a breaking change. Add new optional fields instead.
- **Don't dedupe or batch in the framework.** Subscribers handle that. Emit once per occurrence.
- **One entry per name.** `MochiEventMap` is global — don't reuse a name across subsystems.
- **Don't add a logger line for noisy events** without a verbosity toggle. See how `cache:read` is gated behind `cache: 'verbose'` in `consoleLogger.ts` for the pattern.
