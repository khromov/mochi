---
name: add-extension
description: Add a new hook or filter to Mochi's extension API (`packages/mochi/src/extensions.ts`). Use when the user asks to "add a hook", "add a filter", "create an extension point", or "/add-extension <name>". Walks both halves of the type/runtime kind-map registry and the call-site wiring.
user-invocable: true
---

# Add a hook or filter

Mochi's extension API lives in `packages/mochi/src/extensions.ts`. Each extension point exists in two parallel registries:

- A **type-level kind map** (`MochiHookKindMap` / `MochiFilterKindMap`) that drives TypeScript's narrowing of the user callback signature.
- A **runtime kind table** (`HOOK_KINDS` / `FILTER_KINDS`) that drives whether the invoker awaits the result.

Both must be updated together. This skill walks the full path: registry → call site → test → docs.

## Naming

- Format: `namespace:camelCase` (e.g. `mochi:init`, `csrf:formContentTypes`).
- Pick an existing namespace if one fits. Current namespaces:
  - `mochi:` — framework lifecycle (`mochi:init`, `mochi:listening`, `mochi:jobsMounted`, `mochi:ready`, `mochi:shutdown`)
  - `route:` — per-request route lifecycle (`route:matched`)
  - `csrf:` — CSRF defaults + override (`csrf:formContentTypes`, `csrf:protectedMethods`, `csrf:trustedOrigins`, `csrf:check`)
  - `cookie:` — cookie defaults (`cookie:defaults`)
  - `html:` — HTML shell (`html:shell`)
  - `serverIsland:` — server-island internals (`serverIsland:secretKey`)
  - `compile:` — Svelte compilation pipeline (`compile:preprocessors`)
  - `publicDir:` — public-directory scan results (`publicDir:scan`)
  - `queue:` — background-queue internals (`queue:recoveryStallWarningMs`, `queue:lockDurationMs`)
- Introduce a new namespace only when no existing one applies.
- Names are global — one entry per name across the whole framework.

## Sync vs async

| Use `'sync'` when                                                                           | Use `'async'` when                                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The call site is a synchronous request hot path (e.g. inside `csrfCheck`).                  | The call site is already in async context (e.g. inside `serve()`). |
| The framework cannot afford to `await` (Promise leakage would force every caller to async). | The user fn benefits from being able to do I/O.                    |

If the existing call site is sync, **do not convert it to async** to fit an async kind. Pick `'sync'` instead — Mochi explicitly avoids Promise leakage into sync paths.

## Steps — adding a hook

1. **Decide the call site first.** Open the file and find the exact line where the user fn should run. The call site decides the kind (sync vs async), the context shape, and the namespace.

2. **Edit the type registry** in `packages/mochi/src/extensions.ts`:
   - Add a key to `MochiHookContext` mapping the name to the context object the user receives.
   - Add the same key to `MochiHookKindMap` set to `'sync'` or `'async'`.

3. **Edit the runtime registry** in the same file:
   - Add an entry to `HOOK_KINDS` with the same name and kind. TypeScript will fail to compile if you forget — `HOOK_KINDS` is typed `{ [K in keyof MochiHookContext]: MochiKind }`.

4. **Wire the call site.** At the chosen line, insert:

   ```ts
   await runHook('namespace:name', {/* context */}); // async-kind
   runHook('namespace:name', {/* context */}); // sync-kind (no await)
   ```

   Import `runHook` from `./extensions` if not already imported.

5. **Test it** in `packages/mochi/src/extensions.test.ts`:
   - One case proving the no-op path (no user fn registered) returns/resolves cleanly.
   - One case proving the user fn receives the expected context.
   - For async kinds, one case proving the framework awaits the user fn.

6. **Document it** in `packages/docs/162-extensions.md`. Add a short section with the name, when it fires, and one realistic code example. Match the existing terse style.

## Steps — adding a filter

1. **Decide the call site.** Find where the framework reads the default value today. That's the resolution site. For sync filters consumed in request hot paths, resolve once at startup in `Mochi.serve()` and capture in a closure (the `csrf:formContentTypes` / `csrf:protectedMethods` filters work this way).

2. **Edit the type registry** in `packages/mochi/src/extensions.ts`:
   - Add a key to `MochiFilterValue` mapping the name to the value type (e.g. `Set<string>`, `string[]`, `Record<string, unknown>`).
   - Add the same key to `MochiFilterContext` mapping to the context object passed alongside the value.
   - Add the same key to `MochiFilterKindMap` set to `'sync'` or `'async'`.

3. **Edit the runtime registry** in the same file:
   - Add an entry to `FILTER_KINDS` with the same name and kind.

4. **Export a default** if the value has a canonical framework default. Convention: `DEFAULT_<SCREAMING_SNAKE_CASE>` from the module that owns the value (e.g. `DEFAULT_FORM_CONTENT_TYPES` in `csrf.ts`). Re-export from `packages/mochi/src/index.ts`.

5. **Wire the resolution site:**

   ```ts
   const resolved = applyFilter(
     'namespace:name',
     new SomeContainer(DEFAULT_VALUE), // pass a fresh copy so user mutation can't poison the default
     { options /* + any extra context */ },
   );
   ```

   For Sets/Maps/arrays, **always pass a fresh copy** of the default — the user can mutate-and-return safely without corrupting the next call.

6. **Pass the resolved value to consumers.** If the consumer is a sync function called per-request, add it as a parameter (defaulting to the framework default for backwards compatibility). See `csrfCheck` for the pattern: `formContentTypes` and `protectedMethods` are positional parameters with defaults.

7. **Test it** in `packages/mochi/src/extensions.test.ts`:
   - One case proving no-filter returns the input unchanged.
   - One case proving the user-supplied replacement value flows through.
   - One case proving in-place mutation works.

   Also add a behavioural test where the filter changes real framework behaviour (e.g. the csrf tests verify that an extended `formContentTypes` Set actually changes `csrfCheck`'s decision).

8. **Document it** in `packages/docs/162-extensions.md`.

## Verification

After every change, run:

```sh
bun run typecheck   # type registry + runtime registry stay in sync
bun run test        # extensions.test.ts and any consumer tests
bun run format
bun run lint
```

The runtime kind tables widen the value type to `MochiKind` (`'sync' | 'async'`) so comparisons stay reachable when every current entry happens to share one kind. If you see _"This comparison appears to be unintentional because the types ... have no overlap"_, the type widening is missing.

## Guardrails

- **Never convert a sync framework call site to async** to fit an async-kind hook. Pick `'sync'` instead.
- **Never skip the runtime kind table.** TypeScript-only declarations let the invoker silently return the wrong shape (e.g. `undefined` instead of `Promise<void>`).
- **Never re-resolve a sync filter per-request** if the value doesn't change per-request — resolve once in `serve()` and capture in a closure.
- **Don't add priorities, chains, or multi-entry support.** The "one entry per name" rule is intentional and load-bearing for the simple types.
- Keep the public API additive — adding a new hook/filter must not break existing callers.
