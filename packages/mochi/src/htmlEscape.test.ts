import { describe, expect, test } from 'bun:test';
import { escapeHtmlAttr } from './htmlEscape';

describe('escapeHtmlAttr', () => {
  test('escapes the four attribute-unsafe characters', () => {
    expect(escapeHtmlAttr('a & b "c" <d> e')).toBe('a &amp; b &quot;c&quot; &lt;d&gt; e');
  });

  test('escapes the leading `&` of existing entity sequences so they round-trip', () => {
    // A bare `"`-only replace would leave a literal `&quot;` untouched, so the
    // browser would decode it back to `"` and corrupt the payload. Escaping `&`
    // turns it into `&amp;quot;`, which decodes back to the literal `&quot;`.
    const hostile = 'has &quot; and &amp; and "real quotes" and </script>';
    expect(escapeHtmlAttr(hostile)).toBe('has &amp;quot; and &amp;amp; and &quot;real quotes&quot; and &lt;/script&gt;');
  });

  test('escaped output contains no raw quote or angle bracket', () => {
    const out = escapeHtmlAttr('{"html":"</script><img src=x>"}');
    expect(out).not.toMatch(/["<>]/);
  });
});
