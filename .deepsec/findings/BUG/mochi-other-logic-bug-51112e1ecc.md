# [BUG] htmlToText silently discards all remaining text after a void element in its skip list

**File:** [`packages/demos/src/hn/hn-sanitize.ts`](https://github.com/khromov/mochi/blob/main/packages/demos/src/hn/hn-sanitize.ts#L59-L74) (lines 59, 62, 63, 74)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`skipDepth` is incremented in the `element()` handler and decremented only from the `el.onEndTag()` callback. `embed` is an HTML void element, so per `bun-types/html-rewriter.d.ts:81-86` its `canHaveContent` is `false` and it has no end tag — the `onEndTag` callback never fires. `skipDepth` is therefore incremented permanently, and the `onDocument` text handler's `if (skipDepth === 0)` guard drops every subsequent chunk.

Concretely, `htmlToText('<embed>the rest of the title')` returns `''` rather than `'the rest of the title'`. The same applies to a self-closing `<iframe/>`/`<object/>` in a foreign context. (If Bun instead throws when `onEndTag` is registered on a content-less element, the whole `transform()` call fails — broken either way.)

Reachability is limited in practice: `htmlToText` is applied to HN `title` and (via `previewText`) `text` fields, and HN escapes raw `<`/`>` in user content, so a literal `<embed>` is unlikely to arrive. It is a latent correctness bug in a security-adjacent helper, and the test suite only covers the non-void `script`/`style` cases.

## Recommendation

Skip the depth bookkeeping for content-less elements: in the `element()` handler, `if (!el.canHaveContent) return;` before incrementing, or drive the skip from `el.remove()` and let the rewriter handle content suppression. Add a test for `htmlToText('<embed>tail')`.

## Revalidation

**Verdict:** true-positive

Confirmed as a real defect, but the finding's PRIMARY failure mode is wrong and its parenthetical alternative is what actually happens. I traced the whole chain: lol-html's `Element::on_end_tag` returns `Err` when `can_have_content()` is false; the C API that Bun links does `element.end_tag_handlers().ok_or("No end tag.")` and returns -1; `lol_html.h` documents it explicitly ('Not all elements (for example, `<br>`) support end tags. If this function is called on such an element, this function returns an error code'); Bun's Zig wrapper maps `-1 => error.Fail`; and Bun's JS binding does NOT swallow it — it calls `globalObject.throwValue(err)`, producing an `Error` with `name: "HTMLRewriterError"` and message `"No end tag."`. So `htmlToText('<embed>tail')` does not return `''` — it THROWS synchronously out of `transform(string)`, which for SSR at HNItem.svelte:11 and HNStoryRow.svelte:7-8 falls through to the route handler and renders the error page as a 500. That is a worse consequence than described, and the finding did anticipate it in its parenthetical ('broken either way'). The underlying premise is certain: `canHaveContent` is documented 'false for void elements like <br>', `embed` is void, and the line 63 decrement can therefore never be reached. The decisive evidence that this is a real divergence rather than theory is the framework's own copies of the identical idiom: `email/mailer.ts:27` skips only 'script, style' (no void element) and `utils/index.ts:215-221` applies the counter only to `<mochi-hydratable-island>`/`<mochi-server-island>`, with utils/index.test.ts:126 explicitly pinning 'the onEndTag depth-counter invariant' — the demo copy widened the selector to include `embed` and broke it. The finding's stuck-counter mechanism is also genuinely reachable, just via a different trigger: `onEndTag` is documented not to fire for implicitly-closed elements, so an unclosed `<iframe>`/`<object>` (non-void, so registration succeeds) leaves `skipDepth` at 1 and silently drops all later text exactly as described. The suggested `if (!el.canHaveContent) return;` guard is correct here, since this is Bun-only code. Reachability remains limited and the finding says so honestly: HN escapes a user-typed `<embed>` to `&lt;embed&gt;`, `skipDepth` is a per-call local so there is no cross-request contamination, and output goes through Svelte text interpolation so there is no XSS dimension. Latent but real; BUG is the right severity. Caveat: this chain is source-derived from bun-v1.3.0 (the 1.4.x file has moved) and was not empirically verified, per the static-analysis constraint — but the code is wrong under either failure mode, so the verdict does not depend on it.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-31)
