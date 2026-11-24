# [BUG] Neither network call has a timeout, and `fetchLatestMochiVersion`'s `signal` parameter is dead code

**File:** [`packages/cli/src/utils.ts`](https://github.com/khromov/mochi/blob/main/packages/cli/src/utils.ts#L76-L85) (lines 76, 78, 85)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-missing-timeout`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

fetchLatestMochiVersion accepts a `signal?: AbortSignal` (L76) specifically so callers can bound the request, but the only caller — `create.ts:55`, `resolveMochiVersionRange(await fetchLatestMochiVersion())` — never passes one, and the template `fetch` in `download.ts:57` has no signal either. A registry or codeload connection that opens and then stalls (captive portal, half-open proxy, packet-dropping firewall) leaves `bun create mochi` hanging indefinitely behind a clack spinner that reads 'Downloading … template', with no output and no exit. The try/catch in `fetchLatestMochiVersion` only converts errors into the `^0.1.1` fallback; it cannot rescue a hang. Separately, `json.version` from the registry response is interpolated into `^${version}` and written straight into the scaffold's package.json with no shape validation.

## Recommendation

Pass `AbortSignal.timeout(10_000)` from `create.ts` into `fetchLatestMochiVersion`, and add a signal (or `AbortSignal.timeout`) to the `fetch` in `download.ts`. Validate the registry response with a semver shape check (e.g. `/^\d+\.\d+\.\d+(?:[-+][\w.]+)?$/`) before building the range, falling back to `MOCHI_FRAMEWORK_FALLBACK` otherwise.

## Revalidation

**Verdict:** true-positive

Both halves check out. `fetchLatestMochiVersion(signal?: AbortSignal)` (utils.ts:76-90) threads `signal` into the registry `fetch`, but a repo-wide grep shows exactly one caller — `create.ts:55`, `resolveMochiVersionRange(await fetchLatestMochiVersion())` — which passes nothing, and the only other reference is in `utils.test.ts` for `resolveMochiVersionRange`; the parameter is therefore dead code, which is precisely the kind of 'bounded on purpose, never actually bounded' defect worth reporting. The template `fetch` in download.ts:57 likewise carries only a User-Agent header, no signal. The try/catch in `fetchLatestMochiVersion` converts rejections into the `^0.1.1` fallback and cannot rescue a stall, and both calls sit behind `p.spinner()` ('Downloading … template'), so the user sees no output and no exit. One correction to the severity of the impact: Bun's `fetch` is not unbounded — it has a 300-second default idle timeout (per Bun's release notes, 'not for the cumulative time of the request, but rather the time between each chunk of data received', and since 1.4 one deadline for the whole response header block), so a fully dead connection rejects after ~5 minutes rather than hanging literally forever. A server that trickles body bytes can still extend it indefinitely, and a 5-minute silent spinner is itself a bad failure mode, so the recommendation (`AbortSignal.timeout(10_000)` on both calls) is right. The unvalidated `json.version` interpolation into `^${version}` straight into the scaffold's package.json is also accurate. BUG is the correct severity: this is robustness, not a security boundary.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-08-26)
