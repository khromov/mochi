# [BUG] {{mochi.analytics}} placeholder is expanded against the assembled HTML, so user content can capture it

**File:** [`packages/support/src/index.ts`](https://github.com/khromov/mochi/blob/main/packages/support/src/index.ts#L41) (lines 41)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

The `analytics()` handle wired at L41 substitutes its placeholder with `html.replace('{{mochi.analytics}}', …)` on the already-rendered page (packages/shared/src/index.ts:27). `String.prototype.replace` with a string pattern replaces only the *first* occurrence, and in src/shell.html the real placeholder sits after `{{mochi.body}}` on the same line — so any earlier occurrence in the rendered body wins.

The framework avoids exactly this class of bug for its own slots and says so: `parseShellTemplate` splits the *template*, not the output, because "Splitting the template rather than the assembled output also keeps an injected body containing a literal `{{mochi.script}}` from being re-expanded" (Mochi.ts:152-154). Its regex matches only `head|css|body|script`, so `{{mochi.analytics}}` survives into the output and the shared handle reintroduces the hazard.

Reachable here: an attacker submits a support message whose text is `{{mochi.analytics}}` (HTML-escaping leaves braces untouched). The admin loads `/admin/`, which is not in the `exclude` list, and `SubmissionCard.svelte:23` renders the message. The tracker `<script>` is then injected inside that `<p class="message">` and the genuine placeholder is left behind as visible literal text at the end of `<body>`. Not XSS — the injected snippet is a fixed trusted string from analyticsTracker.html — but it breaks analytics on the page and defaces the panel on attacker demand.

## Recommendation

In packages/shared/src/index.ts, anchor the substitution instead of using a first-match string replace — e.g. split the shell on the placeholder at load time the way `parseShellTemplate` does, or replace from the end (`html.lastIndexOf('{{mochi.analytics}}')`). Alternatively register the slot through the framework's shell-placeholder mechanism so it is resolved against the template rather than the output.

## Revalidation

**Verdict:** true-positive

Confirmed end to end. `analytics()` (packages/shared/src/index.ts:27) runs `html.replace('{{mochi.analytics}}', …)` inside `transformPage`, i.e. against the fully assembled page, and a string first argument to `String.prototype.replace` replaces only the first occurrence. The framework's own slot filler deliberately avoids this: `parseShellTemplate` (Mochi.ts:155-171) splits the *template* with `/\{\{mochi\.(head|css|body|script)\}\}/g`, and the comment at 152-154 says so explicitly — and because that regex does not cover `analytics`, the placeholder survives untouched into the output, where `src/shell.html:123` puts it after `{{mochi.body}}` on the same line. The injection path is reachable: `/admin/` is not in the handle's `exclude` list (only `/newsletter/embed` is), `SubmissionCard.svelte:23` renders `{submission.message}` for an attacker-submitted message, Svelte's text escaping touches `&`/`<` but not braces, and the action only trims and truncates to 5000 chars. So an attacker submits the literal `{{mochi.analytics}}`, the admin opens the panel, and the tracker `<script>` is substituted inside `<p class="message">` while the genuine placeholder is left behind as visible literal text at the end of `<body>`. One correction to the write-up: the injected markup is a fixed trusted constant from analyticsTracker.html with no double quotes in it, so this is not XSS and the tracker still actually loads (just from the wrong DOM node) — the real impact is on-demand defacement of the admin panel. A same-class variant via the email field lands inside `href="mailto:…"`, where the injected markup is swallowed as attribute text and is inert. BUG severity is correct, and anchoring the substitution (split-at-load like `parseShellTemplate`, or `lastIndexOf`) is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-27)
