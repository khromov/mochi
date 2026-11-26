# [MEDIUM] Reserved `__mochi_ah` envelope key is not shadowed on the pure `mochi:defer` path, letting a user-controlled prop key force sealed server-island props to be echoed back in plaintext

**File:** [`packages/mochi/src/compiler/svelteAstPreprocess.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/compiler/svelteAstPreprocess.ts#L295-L217) (lines 295, 313, 217)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `other-info-disclosure`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

Server-island props are sealed into an encrypted envelope built by string concatenation here. When the call site combines `mochi:defer` with `mochi:hydrate`, the framework appends its own transport keys last so they beat any user spread:

  L295: autoEntries = directives.hydrate ? ['islandId: __mochi_iid', '__mochi_ah: "eager"'] : ['islandId: __mochi_iid']
  L313: `{ ...__mochi_props__, islandId: __mochi_iid` + (directives.hydrate ? `, __mochi_ah: "eager"` : '') + ` }`

On the **pure** `mochi:defer` path (no `mochi:hydrate`), `__mochi_ah` is omitted entirely rather than pinned, so whatever `...__mochi_props__` contributes for that key survives into the sealed envelope. The reserved-name guard at L216-223 only rejects a literal `islandId` attribute; it does not cover `__mochi_ah`, and it cannot see keys arriving via `{...spread}` at all.

At the consuming end (`Mochi.ts:1591-1593`) the endpoint reads the hydrate mode straight out of the decrypted payload:

  const { [ALSO_HYDRATE_ENVELOPE_KEY]: rawHydrateMode, islandId: rawIslandId, ...props } = decodedProps;
  const hydrateMode = isAlsoHydrateMode(rawHydrateMode) ? rawHydrateMode : null;

and when `hydrateMode` is non-null it serializes the *entire remaining props bag* into the HTML it returns (`Mochi.ts:1656-1668`):

  const serializedProps = devalueStringify(props);
  hydrateAttrs += ` props="${escapeHtmlAttr(serializedProps)}"`;

This breaks the guarantee the docs state explicitly in `packages/docs/70-server-islands.md:66`: "A pure `mochi:defer` island keeps its props on the server — the token on the wire is opaque and the endpoint returns only HTML." It also silently flips `isHydratable()` to `true` for that render (`Mochi.ts:1627`), which can change which SSR branch the island takes.

The comment at L267-269 shows the author reasoned about exactly this threat for the query-string case ("were it trusted from a `?hydrate=` query param, an attacker could append `hydrate=eager` to any sealed token and have the endpoint echo the props back in plaintext") — moving the flag inside the envelope defeats *token* tampering, but the envelope itself is still built from a spread the app may populate with untrusted keys.

## Recommendation

Pin the reserved key unconditionally instead of omitting it, so a user spread can never supply it: emit `ALSO_HYDRATE_ENVELOPE_KEY: <JSON.stringify(alsoHydrateMode)>` (i.e. `null` for pure defer) as the last entry on both the `mochi:defer:visible` path (L295) and the non-visible path (L313). Defensively, also make the endpoint ignore a non-null mode when the island has no registered client entry, and extend the reserved-attribute check at L216-223 to reject a literal `__mochi_ah` attribute with the same error text used for `islandId`.

## Revalidation

**Verdict:** true-positive

Both ends verified against current HEAD. Producer: svelteAstPreprocess.ts:295 emits `__mochi_ah` in `autoEntries` only when `directives.hydrate` is set, and L313's envelope appends `, __mochi_ah: ...` only under the same condition — so on a pure `mochi:defer` the key is omitted rather than pinned, and whatever `...__mochi_props__` contributes for it survives into the sealed envelope. The reserved-name guard at L216-223 rejects only a literal `islandId` attribute and cannot see spread keys at all. Consumer: Mochi.ts:1591-1593 destructures the mode straight out of the decrypted payload and `isAlsoHydrateMode` accepts it; Mochi.ts:1656-1668 then `devalueStringify(props)` and emits `props="..."` into the returned HTML whenever the mode is non-null. I checked for a secondary guard and there is none: `getComponentEntryUrl` returning undefined only omits `component-url`, the `props=` attribute is still written, and the mode also flips `isHydratable()` context on at L1627. This breaks a guarantee the docs state verbatim — packages/docs/70-server-islands.md: 'A pure `mochi:defer` island keeps its props on the server — the token on the wire is opaque and the endpoint returns only HTML. ... Do not pass server-only secrets to an island you also hydrate.' It also violates the module's own stated invariant: `buildPropsFromAst`'s doc comment (L529-531) says `extraEntries` are 'framework-owned keys appended last so they win over a user spread', which is precisely what does not happen for `__mochi_ah` here. Concrete attack: a page renders `<Widget mochi:defer {...Object.fromEntries(url.searchParams)} apiToken={secret} />`; the attacker requests `?__mochi_ah=eager`, the envelope seals with the mode inside, the browser's ServerIsland fetch of `/_mochi/island/:name` returns the whole props bag — including `apiToken` — as plaintext devalue in a `props` attribute. Exploitation needs the app to spread untrusted keys into a pure-defer island that also carries server-held props, so likelihood is modest, but the control is defeated and the fix (pin `ALSO_HYDRATE_ENVELOPE_KEY: null` unconditionally on both paths) is one line. MEDIUM retained.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-13)
