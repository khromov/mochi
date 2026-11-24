# [BUG] Non-global KEY_LINE regex rewrites only the first MOCHI_KEY line, so rotation can silently not take effect

**File:** [`packages/mochi/src/cli/generateKey.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/cli/generateKey.ts#L7-L55) (lines 7, 55)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`KEY_LINE = /^MOCHI_KEY=.*$/m` (L7) carries `m` but not `g`, and `content.replace(KEY_LINE, () => line)` (L55) therefore substitutes only the first match. If `.env` contains more than one `MOCHI_KEY=` line, the later one survives untouched while the CLI reports `action: 'replaced'` and cli.ts prints `[mochi] Replaced MOCHI_KEY in .env`. Bun's `.env` loader assigns lines in order, so the surviving later assignment is the one the application actually reads — the operator believes the key was rotated when the old value is still live. The `!KEY_LINE.test(content)` guard at L39 means `generateKey` can't create a duplicate itself, but a realistic `.env` can already hold one: a placeholder `MOCHI_KEY=` copied from an example file near the top plus a real key pasted at the bottom, or an `export MOCHI_KEY=…` line (which `^MOCHI_KEY=` does not match, so L41 appends a second definition).

This is a correctness bug rather than an exploitable flaw, but the operation it silently fails is a secret rotation, which is usually performed because the old key is suspected compromised.

## Recommendation

Make the pattern global (`/^MOCHI_KEY=.*$/gm`) and collapse duplicates to a single definition, or detect `>1` match and refuse with an error naming the line numbers so the operator resolves the ambiguity. Consider matching an optional `export ` prefix so the append branch can't introduce a second definition.

## Revalidation

**Verdict:** true-positive

Both premises verified, one of them empirically because the whole severity argument hinges on it. (1) `KEY_LINE = /^MOCHI_KEY=.*$/m` (L7) has `m` but no `g`, and `String.prototype.replace` with a non-global regex substitutes only the first match (L55) — so a second `MOCHI_KEY=` line survives while `action: 'replaced'` is returned and cli.ts L126-127 prints 'Replaced MOCHI_KEY in .env'. (2) I probed Bun's env parser with a file containing `MOCHI_KEY=first` … `MOCHI_KEY=second`: the winner is `second`. So the surviving *later* duplicate is exactly the value the application reads, meaning the operator is told a rotation happened while the live secret is unchanged — a silent failure of an operation usually performed because the old key is suspected compromised. The `!KEY_LINE.test(content)` guard at L39 does prevent `generateKey` from manufacturing the duplicate itself, so this needs a pre-existing one; that's reachable through a hand-merged or pasted `.env` (e.g. a commented/empty placeholder near the top that someone later uncomments, plus a real key at the bottom). One sub-claim is weaker than stated and I'll flag it rather than let it stand: I confirmed Bun's parser *does* honour a leading `export ` (`export EXPORTED_KEY=v` populates `process.env.EXPORTED_KEY`), and `^MOCHI_KEY=` indeed does not match it, so L41 appends a second live definition — but because the appended line comes last it *wins*, so that particular path yields the new key and does not silently fail; it only leaves a stale secret lingering in the file. The core regex defect and its silent-rotation consequence are real regardless. Correctly scoped as a correctness bug, not an exploitable flaw; the recommended `/gm` plus duplicate detection (and matching an optional `export` prefix) is the right fix.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-07-17)
