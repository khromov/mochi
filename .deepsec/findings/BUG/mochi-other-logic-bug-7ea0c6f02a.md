# [BUG] Public-dir reload never writes back to bunRoutes, so the next entry reload reverts the static-file table to its boot snapshot

**File:** [`packages/mochi/src/dev/devWatcher.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/dev/devWatcher.ts#L632-L743) (lines 632, 736, 737, 743)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`reloadPublic` (L732-745) rescans `publicDir`, builds a fresh route table in the local `nextRoutes` (starting from `baseBunRoutes`, which by design never held public routes — Mochi.ts:1827 snapshots it before `registerPublicRoutes(bunRoutes, ...)` at :1859), reloads the server with it, and then discards it. Neither `bunRoutes` nor `baseBunRoutes` is updated.

So `bunRoutes` keeps the boot-time public file set forever. The next `server.reload({ routes: { ...bunRoutes, ... } })` from `triggerEntryReload` (L631-639, fired whenever an entry edit adds or removes a route pattern) silently reverts every public-dir change made during the session: a file added after boot stops being served (hard 404 — `composedFetch` has no public-dir fallback, only client assets, fonts and imported CSS), and a file deleted after boot is re-registered. The symptom is confusing because it is triggered by an unrelated edit to `routes.ts`, and it heals only until the next entry reload if the developer touches the public dir again.

## Recommendation

Have `reloadPublic` rebuild in place: clear the previously registered public keys from `bunRoutes` (diff against `baseBunRoutes`), re-run `registerPublicRoutes(bunRoutes, freshPublic, publicRouteGuard)`, then reload from `bunRoutes` — the same object the entry-reload path uses — so both paths share one source of truth.

## Revalidation

**Verdict:** true-positive

Traced and confirmed in full. `baseBunRoutes` is snapshotted at Mochi.ts:1827, before `registerPublicRoutes(bunRoutes, initialPublicFiles, publicRouteGuard)` runs at 1859, so by construction it never holds public routes while `bunRoutes` holds the boot-time set. `reloadPublic` (devWatcher.ts:734-744) rescans the directory, builds `nextRoutes` from `{ ...baseBunRoutes }`, calls `registerPublicRoutes(nextRoutes, …)` — which I confirmed mutates its first argument in-place (publicDir.ts:86-105) — reloads the server from `nextRoutes`, and then discards it; neither `bunRoutes` nor `baseBunRoutes` is updated. `triggerEntryReload` reloads from `{ ...bunRoutes, '/__mochi_live_reload': … }` (L631-639) whenever `counts.added.length > 0 || counts.removed.length > 0`, which restores the boot-time public set. The 404 claim also checks out: `composedFetch` (Mochi.ts:1863-1935) falls back only to registered client files, font assets and imported CSS, then `userFetch` or a 404 — there is no public-dir fallback, so a file added after boot genuinely becomes a hard 404 after an unrelated `routes.ts` edit, and a file deleted after boot is resurrected. The confusing-symptom framing is accurate because the trigger is an entry edit, not a public-dir edit, and the state heals only until the next entry reload. Note the live table is correct immediately after `reloadPublic` (it is a complete rescan from a base that includes entry-added routes via `addBunRoute`, which does write both maps) — the defect is purely the stale `bunRoutes`. Dev-only DX bug, correctly filed as BUG, and the suggested in-place rebuild is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-10-05)
