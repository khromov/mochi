# [BUG] pretty-bytes is permanently excluded from the vendored-version check

**File:** [`scripts/check-vendored-versions.ts`](https://github.com/khromov/mochi/blob/main/scripts/check-vendored-versions.ts#L8-L45) (lines 8, 16, 17, 18, 33, 45)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** high  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

VENDORED_FROM_RE (L8) requires the provenance comment to be in the form `Vendored from https://github.com/<owner>/<repo> <version>`. But packages/mochi/src/vendor/pretty-bytes/index.ts line 1 records it as "// Vendored from `pretty-bytes@7.1.0` (MIT, Sindre Sorhus). Trimmed: no BigInt ..." — there is no github.com URL anywhere in the file (verified by grep). The regex therefore never matches, the script takes the `error: 'no "Vendored from" comment found'` branch (L17-19), prints a line and `continue`s (L26-29), and never queries npm for that package. So 1 of the 5 vendored packages is silently never compared against its upstream release — exactly the job this script exists to do. Compounding it, the script has no non-zero exit path: both the missing-comment branch and the npm-lookup-failure branch (L33-36) just log and continue, and `main()` always resolves, so `bun run check-vendored-versions` exits 0 even when it checked nothing. Since .claude/skills/update-vendored/SKILL.md Step 1 instructs the agent to 'If everything is current, report that and stop', a reader can reasonably conclude all vendored code is up to date while pretty-bytes was never actually checked and could sit arbitrarily far behind upstream (including behind security fixes).

## Recommendation

Either normalize the pretty-bytes header to the canonical `// Vendored from https://github.com/sindresorhus/pretty-bytes 7.1.0` form, or broaden the parser to also accept the `pkg@version` form (e.g. a second regex /Vendored from `([^`@]+)@(\S+)`/). Additionally, make failures loud: collect error/lookup-failure cases and `process.exitCode = 1` at the end of main(), and attach `main().catch(...)` so the script's exit status reflects whether every vendored package was actually checked.

## Revalidation

**Verdict:** true-positive

Confirmed with direct evidence. VENDORED_FROM_RE (L8) requires the literal 'Vendored from https://github.com/<owner>/<repo>…' form. I grepped every vendored index.ts: debounce, js-cookie, json-format-highlight and slugify all carry a conforming github.com line (and json-format-highlight's '/tree/master' variant is absorbed by the regex's optional (?:\/\S*)? group, so it matches correctly), while packages/mochi/src/vendor/pretty-bytes/index.ts L1 reads '// Vendored from `pretty-bytes@7.1.0` (MIT, Sindre Sorhus). Trimmed: no BigInt'. A separate grep for 'github.com' across the entire pretty-bytes directory returned zero hits, so the regex cannot match anywhere in the file. Execution therefore takes the `{ name, error: 'no "Vendored from" comment found' }` branch at L17-19 and `continue`s at L26-29, and fetch to registry.npmjs.org is never reached — so 1 of the 5 vendored packages is never compared against upstream, which is the script's entire purpose. The compounding exit-status claim also checks out: the missing-comment branch and the npm-lookup-failure branch (L33-36) both only log and continue, there is no process.exitCode or process.exit anywhere in the file, and main() is called bare at L45, so `bun run check-vendored-versions` exits 0 even having checked nothing. The documented workflow amplifies it: .claude/skills/update-vendored/SKILL.md Step 1 says the script 'prints, per vendored script: the pinned version … and the latest version on npm. If everything is current, report that and stop.' One calibration: the failure is not fully silent — the pretty-bytes row is printed in red with the error text — so an attentive operator would see something is wrong; 'never actually compared to upstream, with a success exit code' is the accurate statement rather than 'invisible'. Both recommended fixes are appropriate; normalizing the header is the minimal one, and the exit-code hardening is what prevents recurrence.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-01)
