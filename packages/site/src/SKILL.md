---
name: mochi
description: Use whenever the user asks to build, add, or modify anything in this Mochi app — pages, routes, islands, selective/lazy/server hydration, forms, JSON/WS/SSE endpoints, cookies, caching, or request context. Before writing any framework code, invoke the "mochi" skill to fetch the relevant Mochi docs and demos.
user-invocable: true
---

# Build with Mochi

This project is a Mochi app — a server-first Svelte 5 framework on Bun with islands-based selective hydration. Mochi has framework-specific syntax that must **not** be guessed: `mochi:hydrate`, `mochi:hydrate:visible`, `mochi:defer`, `serverProps`, `Mochi.page/api/ws/sse`, `hydratable()`, the request context, and form actions all have exact shapes. The docs and every demo's source are published as plain-text `llms.txt` files. Fetch the relevant ones before you write code.

## Workflow

1. **Discover.** Fetch the index: `https://mochi.fast/llms.txt`. It lists every doc under `## Docs` and every demo under `## Examples` — each a one-line description plus a link to that section's own `llms.txt`.
2. **Select.** Read the user's request and pick a set of docs and demos URLs whose descriptions match the task — usually 3–6 sections. Always include the relevant demo(s): they are working examples.
3. **Fetch.** Fetch each selected `.../llms.txt` URL and read it carefully before writing any code.
4. **Implement.** Carry out the request using the patterns from the fetched docs/demos, following the conventions already present in this app's `src/` files.

## Picking sections

Match the request to the descriptions in the live `/llms.txt` index — that index is the source of truth. A few examples of the kind of mapping to make:

- _"Add a counter button"_ → interactivity, so fetch the `selective-hydration` doc and the `hydration` demo.
- _"Load data per request"_ → fetch the `request-context` doc and the `server-props` demo.
- _"Build a login form"_ → fetch the `progressively-enhancing-forms-with-enhance` doc and the `login` demo.
- _"Add a JSON endpoint"_ → fetch the `api-routes` doc and the `api` demo.

When a request spans several concerns (e.g. a cached API that feeds a hydrated island), fetch one or two sections per concern rather than a single best guess.

## Notes

- Under `## Optional` the index links `/llms-recommended.txt` (all docs concatenated) and `/llms-full.txt` (all docs + every demo's source). Reach for these only when the task is broad; otherwise fetch targeted sections to keep context tight.
- `/llms.json` is a machine-readable variant of the index — `{ title, description, url }` per doc and demo — if structured selection is easier than parsing the text index.
- The docs live at **`https://mochi.fast`** (the Mochi docs site), independent of where this app runs. Always fetch docs from there.
