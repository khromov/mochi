# [BUG] readVarint overflows to NaN, silently defeating the length bounds check

**File:** [`packages/mochi/src/image/imageCodec.ts`](https://github.com/khromov/mochi/blob/main/packages/mochi/src/image/imageCodec.ts#L36-L96) (lines 36, 45, 96)
**Project:** mochi
**Severity:** BUG  •  **Confidence:** medium  •  **Slug:** `other-logic-bug`

## Owners

**Suggested assignee:** `stanislav.khromov+github@gmail.com` _(via last-committer)_

## Finding

`readVarint` (L34-48) accumulates with floating-point multiplication: `shift *= 128`. After ~147 continuation bytes `shift` exceeds Number.MAX_VALUE and becomes `Infinity`; a `0x80` byte then computes `(0x80 & 0x7f) * Infinity === 0 * Infinity === NaN`, so `result` is `NaN`. The caller's bounds check at L96 is `if (cursor.i + nameLen > buf.length) return null` — any comparison with `NaN` is `false`, so the guard does not fire. Execution continues into `Buffer.from(buf.buffer, buf.byteOffset + cursor.i, nameLen)` with `nameLen = NaN` and then `cursor.i += NaN`, making every subsequent offset and length `NaN`. Node coerces those to 0, so today the practical result is an empty `size` and empty `src` (and a downstream 400), not memory disclosure — but a bounds check that cannot reject is a latent hazard, and the loop is only reachable with an authenticated-looking payload, i.e. via the AAD-confusion finding above.

## Recommendation

Bound the varint explicitly: cap the loop at 5 iterations (or 32 bits), use integer shifts / `BigInt`, and reject with `return null` when the accumulated value is not a safe non-negative integer. Also make the L96 check positive (`if (!Number.isSafeInteger(nameLen) || nameLen < 0 || cursor.i + nameLen > buf.length) return null`) so a non-finite length fails closed.

## Revalidation

**Verdict:** true-positive

The arithmetic defect is exactly as described and I verified it line by line. `readVarint` accumulates with `result += (byte & 0x7f) * shift; shift *= 128`, all in doubles. `128^n` exceeds Number.MAX_VALUE once 7n > 1024, i.e. at n = 147, so after 147 continuation bytes `shift === Infinity`. A following `0x80` byte then computes `(0x80 & 0x7f) * Infinity === 0 * Infinity === NaN`, and `result` is NaN from then on (a terminator byte with payload 0 returns NaN; a terminator with a nonzero payload returns Infinity instead). At `imageCodec.ts:96` the guard is `if (cursor.i + nameLen > buf.length) return null`; `NaN > x` is false, so the guard provably cannot reject a NaN length — a real, demonstrable logic defect in a bounds check. I also confirmed the Infinity branch is safe (`cursor.i + Infinity > buf.length` is true → null) and that the existing tests only cover the short-overrun and truncated-varint cases (`unpackImageRequest(new Uint8Array([HAS_SIZE, 100]))` and `[HAS_SIZE, 0x80]`), not the overflow. I agree with the finding's own honest assessment of impact: Node/Bun's `fromArrayBuffer` coerces a non-positive/NaN `length` to 0 (`length = +length; if (length > 0) {...} else { length = 0 }`), so `size` becomes '' and `cursor.i` becomes NaN, making `srcRest` empty too; the outcome is `{src: 'http://'}` and a downstream 400, not an out-of-bounds read or memory disclosure. Reachability is also narrower than the finding implies: the varint only runs past byte 1, and every token shape I could find whose plaintext is reachable here (devalue island props starts `[{`, captcha/clearance JSON starts `{"`) terminates the varint on the second byte because its high bit is clear, so you would need a payload with 148+ consecutive high-bit-set bytes sealed under a reproducible AAD. So: a real defect worth fixing as defense-in-depth behind the F1/F7 confusion, correctly filed as a BUG rather than a vulnerability, and the finding does not overclaim.

## Recent committers (`git log`)

- Stanislav Khromov <stanislav.khromov+github@gmail.com> (2026-09-07)
