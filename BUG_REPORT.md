# svelte-shaker bug: folding a prop used as a `class:` shorthand emits invalid `class:false`

## Summary

When a prop is consumed **only** through a `class:` directive shorthand (e.g.
`class:compact`) and svelte-shaker folds that prop to a constant, the prop value is
substituted into the **directive name** instead of being handled as a directive value.
The result is syntactically/semantically invalid Svelte source like `class:false`, which
in turn makes the Svelte compiler emit broken JavaScript.

- **Package:** `svelte-shaker@0.2.0`
- **Level:** L0/L1 (plain `svelteShaker`, no monomorphization needed to trigger)
- **Peer:** `svelte@^5` (observed with `svelte@5.56.2`)

## Reproduction

Self-contained, uses only the public API (`svelteShaker`) with an in-memory file map — no
bundler, no filesystem:

```js
// repro.mjs  ->  node repro.mjs   (or: bun repro.mjs)
import { svelteShaker } from 'svelte-shaker';

const files = new Map([
  [
    '/Button.svelte',
    `<script>let { compact = false } = $props();</script>\n` +
      `<button class:compact class="btn">click</button>`,
  ],
  // The only call site, app-wide, omits `compact` — so it folds to its default `false`.
  ['/App.svelte', `<script>import Button from './Button.svelte';</script>\n<Button />`],
]);

const resolve = (source, importer) =>
  source.startsWith('.') ? new URL(source, `file://${importer}`).pathname : null;
const readFile = (id) => files.get(id);

const shaken = await svelteShaker([...files.keys()], resolve, readFile);
console.log(shaken['/Button.svelte']);
```

## Actual output

```svelte
<script></script>
<button class:false class="btn">click</button>
```

The `compact` binding is (correctly) folded away, but `class:compact` is rewritten to
`class:false` — substituting the folded **value** into the directive **name**.

`class:false` is not valid Svelte. `svelte/compiler` happens to parse it without throwing,
but then emits invalid JavaScript (a downstream bundler/parse step fails, e.g. Bun reports
`Expected " =" but found "}"` / `Unexpected )`).

## Expected output

`class:compact` is shorthand for `class:compact={compact}`. With `compact` folded to
`false`, the directive can never apply the class, so the sound result is to **drop the
directive entirely**:

```svelte
<script></script>
<button class="btn">click</button>
```

(Emitting `class:compact={false}` would also be valid, though dead.)

## Root cause hypothesis

The folding pass appears to treat the `class:<name>` shorthand as if `<name>` were an
expression to substitute, replacing the directive's name token with the folded literal,
rather than folding the directive's (implicit) value expression. The same likely affects
other shorthand directives whose name doubles as the value identifier (e.g. `style:`,
attribute shorthands `{compact}`), though only `class:` was verified here.

## Impact

Any component that (a) declares a boolean-ish prop, (b) uses it solely via a `class:`
shorthand, and (c) has that prop fold to a constant across the app, will be rewritten to
invalid source and break the build. It needs no L2/monomorphization — plain whole-program
shaking triggers it.

## Workaround

Write the class with an explicit expression so there is no shorthand name to clobber:

```svelte
<!-- before -->
<button class:compact>…</button>

<!-- after -->
<button class={compact ? 'compact' : ''}>…</button>
```

…or exclude the affected component from shaking.
