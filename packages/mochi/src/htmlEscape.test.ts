import { describe, expect, test } from 'bun:test';
import { escapeHtmlAttr, unescapeHtmlAttr } from './htmlEscape';

describe('escapeHtmlAttr', () => {
  test('escapes the four attribute-unsafe characters', () => {
    expect(escapeHtmlAttr('a & b "c" <d> e')).toBe('a &amp; b &quot;c&quot; &lt;d&gt; e');
  });

  test('round-trips payloads that already contain entity sequences', () => {
    // The regression a bare `"`-only replace causes: a literal `&quot;` in the
    // payload would come back as `"` after the browser decodes the attribute.
    const hostile = 'has &quot; and &amp; and "real quotes" and </script>';
    expect(unescapeHtmlAttr(escapeHtmlAttr(hostile))).toBe(hostile);
  });

  test('escaped output contains no raw quote or angle bracket', () => {
    const out = escapeHtmlAttr('{"html":"</script><img src=x>"}');
    expect(out).not.toMatch(/["<>]/);
  });
});
