# [BUG] MemoryNonceStore iterates the entire map on every consume, making the default replay store quadratic

**File:** [`packages/mochi/src/captcha/nonceStore.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/captcha/nonceStore.ts#L7-L19) (lines 7, 11, 12, 13, 14, 15, 19)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-algorithmic-dos`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

consume() prunes inline by walking every entry in `this.seen` (L11-15) before each insert. Entries live until `iat + maxAgeMs + driftAllowanceMs`, i.e. about 15.5 minutes with the defaults, and 'memory' is the default store (config.ts:59). Cost per successful verification therefore scales linearly with the number of nonces spent inside that window, making the endpoint O(n^2) overall, and because the scan is synchronous JS it blocks the event loop for every other request. In the common case it is pure waste — nothing is expired, so the full walk deletes nothing. The code comment at L9-10 rests on the assumption that 'this map only grows one entry per successful send, so the scan stays tiny', which holds only at low volume. An attacker willing to pay the proof-of-work (2^19 hashes at the default, a fraction of a second of native CPU per token, and nonces are server-minted so they cannot be chosen) can sustain enough valid solves to push n into the millions within one window, at which point every subsequent verify blocks on a multi-million-entry Map walk. That this is an oversight rather than an accepted cost is clear from nonceStore.test.ts:77-89, where the authors wrote a dedicated test ('prunes via an index rather than scanning the table') asserting the SQLite store's prune uses nonces_expires_at and does NOT 'SCAN nonces' — the memory store does exactly the scan they engineered away in SQLite.

## Recommendation

Stop scanning per call: keep insertion-ordered expiry and shift only the already-expired head entries (a Map preserves insertion order, and with a fixed window expiry order matches insertion order), or amortise the sweep behind a time/size trigger. Also cap the map and reject (fail closed) once a sane ceiling is hit so growth is bounded regardless of traffic.

## Revalidation

**Verdict:** true-positive

The algorithmic claim is exactly right: `consume()` walks every entry in `this.seen` (L11-15) before each insert, so one successful verification costs O(n) and sustained traffic is O(n^2); the walk is synchronous JS and blocks the event loop for all other requests; and in the steady state it usually deletes nothing. 'memory' is the default store (config.ts:59), entries live until `iat + maxAgeMs + driftAllowanceMs` (≈15.5 min with defaults, via `expiresAt` at captcha.ts:117), and there is no cap on the map. The authors' justification at L9-10 ('this map only grows one entry per successful send, so the scan stays tiny') is an assumption about volume, not an invariant. The finding's supporting evidence is accurate — I read nonceStore.test.ts:77-89 and it is precisely `test('prunes via an index rather than scanning the table')`, asserting `USING INDEX nonces_expires_at` and `not.toContain('SCAN nonces')` for the SQLite store, i.e. the authors engineered away in SQLite exactly the scan the memory store performs. I'm downgrading from MEDIUM to BUG on exploitability. I traced the insert path in verifyCaptcha: `store.consume` at L118 runs only after minBits, the age floor, the expiry bound and the PoW check all pass, so every entry costs the attacker a genuine 2^bits solve (2^19 by default) plus one mint request and one submit request. That makes the economics backwards for a DoS: the attacker pays tens of milliseconds of CPU per entry, and the server's per-consume walk only approaches that cost once n reaches the millions, which requires roughly a hundred cores sustained for the full 15.5-minute window while simultaneously pushing thousands of requests per second at the app — at which point the flood, not the Map walk, is the problem. The unbounded growth (no ceiling, so memory is attacker-influenced) is arguably the more real half. Worth fixing as the finding recommends (insertion-ordered head-shifting plus a hard cap), but it is a scalability/robustness defect rather than a practical availability vulnerability.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
