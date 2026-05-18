---
name: svelte-style-docs
description: Author or revise documentation in the Svelte-style official-docs voice as adapted for Mochi — terse, imperative, code-first, with the distinctive "Do NOT … instead, …" footgun directive. Use when the user asks to "write Svelte-style docs", "document X in the Svelte style", "/svelte-style-docs <topic>", or asks to revise a page to match the Svelte corpus voice.
user-invocable: true
---

# Writing Guide: Svelte-Style Technical Documentation (for Mochi)

This guide distills the conventions, voice, and structural patterns used in the Svelte documentation, adapted for Mochi. Follow it when authoring new documentation that should feel native to this corpus.

---

## 1. Document Framing

### 1.1 Top-level system tag (optional)

If the document is being fed to an LLM or tool, open with a single-line `<SYSTEM>` tag describing the document's scope:
<SYSTEM>This is the abridged developer documentation for [Library].</SYSTEM>

### 1.2 Top-level title

Use a single `#` heading naming the library or major area:
Mochi documentation

Follow it with a brief orientation sentence if the section is broad enough to need one (e.g. "Mochi renders Svelte 5 components on the server and ships JavaScript only for islands marked with `mochi:hydrate*` or `mochi:defer`."). Otherwise dive straight into content.

---

## 2. Heading Hierarchy

Use a strict, predictable hierarchy:

- `#` — Library name (once per document)
- `##` — Major topic (e.g. "Routing", "Loading data", "Hooks")
- `###` — Concrete API, directive, or sub-topic (e.g. `### $state`, `### Mochi.page`)
- `####` — Variants or narrow refinements (e.g. `#### $state.raw`, `#### actions`)

**Heading content conventions:**

- Name runes, directives, and APIs **literally** as headings: `### $derived`, `### mochi:hydrate`, `### Mochi.api (JSON endpoints)`.
- Where a heading needs disambiguation, append a parenthetical: `### Mochi.api (JSON endpoints)`, `## Server islands (experimental)`.
- Do NOT use sentence-style headings ("How to use derived state"); instead, use the API name itself as the heading.

---

## 3. The Voice

The voice is **terse, imperative, and opinionated**. Read like a senior engineer giving directions.

- Address the reader as "you".
- Prefer imperative verbs: "Use", "Set", "Call", "Place", "Export".
- State guidance as rules, not suggestions: "Layout data flows downward", not "Layout data tends to flow downward".
- No hedging adverbs ("perhaps", "maybe", "you might want to"). Cut them.
- No marketing language. No "powerful", "elegant", "easy". Describe behavior.

---

## 4. The Core Pattern: Bulleted Rule + Example

Most subsections follow this rhythm:

1. A **bolded lead-in** naming the concept.
2. A one-sentence rule describing what it does or when to use it.
3. An `_Example:_` line.
4. A fenced code block.
5. Optional: a `Do **NOT** … instead, …` directive.
6. Optional: an italicized `_In [previous version]…_` migration note.

**Template:**

Concept name:
Behavioral description in one sentence.
Example:

language // code

Do NOT [common mistake]; instead, [correct approach].
In [previous version], [old way]; now [new way].

**Real-shape example:**

Parameterization:
Snippets accept multiple parameters with optional defaults and destructuring, but rest parameters are not allowed.
Example with parameters:

svelte {#snippet name(param1, param2)}

<!-- snippet markup here -->

{/snippet}

---

## 5. The "Do NOT / instead" Directive

This is the single most distinctive pattern in the corpus. Use it whenever there is a known footgun.

**Form:**

Do NOT [anti-pattern]; instead, [correct pattern].

**Rules for using it:**

- Bold the word **NOT** with double asterisks. Always.
- Use a semicolon before "instead", lowercase "i" after.
- Keep both halves short — one clause each.
- Place it immediately after the rule or example it warns against, never as a standalone bullet detached from context.
- One directive per concern. Do NOT chain multiple "instead"s into one bullet.

**Examples of the form:**

- Do **NOT** destructure reactive proxies (e.g., `let { done } = todos[0];`), as this breaks reactivity; instead, access properties directly.
- Do **NOT** use `$effect` for state synchronization; instead, use it only for side effects like logging or DOM manipulation.
- Do **NOT** mutate props directly; instead, use callbacks or bindable props to communicate changes.

For absolute prohibitions where there is no "instead", use a flat assertion in caps:

- You **MUST** use the Svelte 5 API unless explicitly tasked to write Svelte 4 syntax.
- Do NOT commit `.mochi/` to version control.
- Do NOT return a `form` prop from a `Mochi.page` route that declares `actions`; the name is reserved.

---

## 6. Migration / Comparison Notes

When a current API supersedes an old one, append an italicized contrast note. This anchors the new reader and accelerates the migrating reader.

**Form:**
In [old version], [old syntax/approach], e.g. [old code]; now use [new approach] instead, e.g. [new code].

**Examples:**

- _In Svelte 4, you created state with let, e.g. `let count = 0;`, now use the $state rune, e.g. `let count = $state(0);`._
- _In Svelte 4 you used `$:` for this, e.g. `$: doubled = count * 2;`, now use the $derived rune instead, e.g `let doubled = $derived(count * 2);`._
- _earlier Mochi versions exposed request data via per-route arguments, do NOT pass `request`/`params` through props anymore — read them from `getRequestContext()` in `mochi-framework`._

Place these notes **after** the rule and example, not before. The current API leads; history follows.

---

## 7. Code Examples

### 7.1 Language tagging

Always tag fenced code blocks with a language: `js`, `ts`, `svelte`, `json`, `css`. Never leave a fence untagged.

### 7.2 File path comments

When an example is tied to a specific file location, prefix the code with a path comment:

```ts
// file: src/routes.ts
import { Mochi } from 'mochi-framework';

export const routes = {
  '/login': Mochi.page('./src/Login.svelte', {
    actions: {
      default: async (event) => {
        // TODO log the user in
      },
    },
  }),
};
```

For Svelte components use an HTML comment:

```svelte
<!-- file: src/Login.svelte -->
<script>
  let { form } = $props();
</script>

{form?.error ?? ''}
```

### 7.3 Minimalism

Examples should show **only the lines required to teach the point**. Strip imports unless they are part of the lesson. Strip styling. Strip error handling unless that is the lesson.

Bad: a 40-line example showing a full component when 4 lines demonstrate the rune.
Good:

```svelte
<script>
  let count = $state(0);
  let doubled = $derived(count * 2);
</script>

<button onclick={() => count++}>{doubled}</button>
```

### 7.4 Pairing two files

When showing how two files interact (e.g. a route's `serverProps` and the page component that consumes them), present them as **two consecutive blocks**, each with its `// file:` comment, in dependency order (provider first, consumer second):
// file: src/routes.ts
export const routes = {
'/foo': Mochi.page('./src/Foo.svelte', {
serverProps: async () => ({ result: await loadResult() }),
}),
};

<!-- file: src/Foo.svelte -->
<script>
  let { result } = $props();
</script>

{result}

---

## 8. Inline Code Conventions

Wrap the following in single backticks every time:

- Rune and API names: `$state`, `$derived`, `Mochi.serve`, `redirect`
- File names and paths: `routes.ts`, `src/lib/server/`, `index.ts`
- Type names: `MochiFormActions`, `MochiCookieJar`, `Handle`
- Module specifiers: `mochi-framework`, `mochi`
- Code fragments inside prose: `let count = $state(0)`
- HTML attributes and event names: `onclick`, `mochi:hydrate`, `mochi:defer`
- CLI commands: `bun run dev`, `bun run start`

Do NOT bold or italicize code; leave it as backticked monospace.

---

## 9. Bold and Italic

**Bold** is for:

- Lead-in terms at the start of a bullet (`**Definition & Usage:**`, `**Where you can use await**`)
- The word **NOT** in directives
- Warning words inside prose where emphasis is critical

_Italics_ are for:

- Migration/historical notes (`_In Svelte 4…_`)
- The literal label `_Example:_` introducing a code block
- Brief asides (`_Usage caution:_ …`)

Do NOT use bold for general emphasis throughout sentences. The page should not look highlighter-yellow.

---

## 10. Section Templates

### 10.1 API reference template

For each API, rune, or function:
apiName

One-line description of what it does and when to use it. Example:

language// minimal example

Do NOT [misuse]; instead, [correct use].
In [old version], [old way]; now [new way].

### 10.2 Route-registration template (Mochi-style)

For each route helper (`Mochi.page`, `Mochi.api`, `Mochi.ws`, `Mochi.sse`):
Mochi.helper

What this helper is for, in one line.
What its options can contain, with a tight code example.
What it cannot do, stated as Do **NOT** … instead, ….

Example shape from the corpus:
Mochi.page

Register an SSR Svelte page via Mochi.page(componentPath, { serverProps?, actions? }); the component receives serverProps as $props and the form state as form when actions return fail/success.
serverProps may be an object or a (req, params) => props resolver; actions is a MochiFormActions map handling POST submissions.
Do NOT return a form prop from serverProps when actions is declared; instead, let fail/success populate it.

### 10.3 Reference list template

For exhaustive import/symbol listings, use this compact form:

symbolName (version): one-line description

language import { symbolName } from 'module';
symbolName(args);

The version annotation `_(v2.18+)_` is italicized and parenthesized. Omit it when not version-gated.

---

## 11. Lists

- Bullets are the default. Most content lives in `-` bulleted lists.
- Numbered lists only for ordered procedures (e.g. "1. Scaffold, 2. Install, 3. Run").
- Sub-bullets indent two spaces and are used sparingly for clarifying a parent point.
- Each bullet should hold one idea. If a bullet runs over three lines, split it or convert it into a labeled paragraph with a bolded lead-in.

---

## 12. Cross-References

- Refer to other concepts by their literal name in backticks: "see `Mochi.page`", "use `redirect` from `mochi-framework`".
- Do NOT use phrases like "as discussed in the previous section" — name the section or symbol directly.
- Do NOT include URL links for internal concepts; the surrounding documentation provides navigation.

---

## 13. Versioning and Stability

- Mark experimental APIs explicitly in the heading: `## Server islands (experimental)`.
- State the opt-in flag and its file plainly:

Opt-in: Enable in your `Mochi.serve()` call:

js Mochi.serve({
experimental: { serverIslands: true },
});

- Note removal timelines flatly: "The flag is experimental in 0.8; it will be removed in 1.0."
- Tag version-introduced symbols inline: `_(v0.18+)_`, `_(v0.4+)_`.

---

## 14. What to Omit

The corpus is deliberately abridged. When in doubt, cut.

- No introductions ("In this section we will learn…"). Start with the rule.
- No conclusions ("And that's how derived works!"). End on the last rule or example.
- No history beyond a one-line migration note.
- No analogies to other frameworks unless absolutely clarifying.
- No screenshots or diagrams; everything is text and code.
- No "pros and cons" lists. State the recommendation; mention tradeoffs only as a single `Do NOT … instead …` line.

---

## 15. Worked Mini-Example

To show the style end-to-end, here is what a fresh API entry should look like:
$someRune

$someRune registers a value as [behavior]. For example:

svelte <script>
let value = $someRune(initial);
</script>

Do NOT call $someRune outside of a component or .svelte.js module; instead, restrict its use to reactive contexts.
In Svelte 4, you achieved this with [old API], e.g. oldApi(initial); now use $someRune instead.

$someRune.variant

Use $someRune.variant when [narrower condition]. For example:

js const x = $someRune.variant(() => expensiveCompute());

Do NOT use .variant for the common case; instead, prefer plain $someRune.

---

## 16. Checklist Before Publishing

Run through this list against any new section:

- Heading uses the literal API or file name.
- First bullet states the rule in one sentence.
- At least one minimal, language-tagged code example.
- File-path comment present where the example is location-bound.
- A `Do **NOT** … instead, …` line for every common mistake.
- Migration note in italics if the API replaces an older one.
- All API names, files, types, and modules are backticked.
- No filler sentences, no hedging adverbs, no marketing words.
- Bullets carry one idea each; long bullets split.
- The reader can act on the section without reading anything else.
