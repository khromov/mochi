import { describe, expect, test } from 'bun:test';
import { htmlToText, safeUrl, sanitizeHtml } from './hn-sanitize.ts';

describe('safeUrl', () => {
  test('accepts http and https URLs', () => {
    expect(safeUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(safeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  test('rejects javascript: URLs', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeUrl('  javascript:alert(1)')).toBeNull();
  });

  test('rejects data: URLs', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  test('rejects file:, vbscript:, and other schemes', () => {
    expect(safeUrl('file:///etc/passwd')).toBeNull();
    expect(safeUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeUrl('about:blank')).toBeNull();
  });

  test('rejects malformed and protocol-relative URLs', () => {
    expect(safeUrl('not a url')).toBeNull();
    expect(safeUrl('//evil.example.com')).toBeNull();
  });

  test('entity-encoded hrefs without decoding produce garbled URLs (# treated as fragment)', () => {
    // The # in &#x2F; is treated as a URL fragment delimiter, so the URL constructor
    // returns a garbled https URL instead of throwing. sanitizeHtml must decode first.
    const result = safeUrl('https:&#x2F;&#x2F;youtu.be&#x2F;path');
    expect(result).not.toBeNull();
    expect(result).not.toBe('https://youtu.be/path');
  });

  test('accepts decoded https URL', () => {
    expect(safeUrl('https://youtu.be/Fb0w5OT1U58')).toBe('https://youtu.be/Fb0w5OT1U58');
  });

  test('rejects empty and nullish input', () => {
    expect(safeUrl('')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl(undefined)).toBeNull();
  });
});

describe('sanitizeHtml — script-execution vectors', () => {
  const dangerSubstrings = [
    'javascript:',
    'JaVaScRiPt',
    'alert(',
    'onload',
    'onerror',
    'onclick',
    'onfocus',
    'onmouseover',
    'srcdoc',
    'data:text/html',
    '<script',
    '<iframe',
    '<svg',
    '<img',
    '<style',
    '<object',
    '<embed',
  ];

  function assertNoDanger(input: string) {
    const out = sanitizeHtml(input);
    for (const needle of dangerSubstrings) {
      expect(out.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    return out;
  }

  test('strips <script> blocks entirely', () => {
    const out = assertNoDanger('<p>before</p><script>alert(1)</script><p>after</p>');
    expect(out).toContain('before');
    expect(out).toContain('after');
  });

  test('strips <img onerror=...> entirely', () => {
    assertNoDanger('<img src=x onerror="alert(1)">');
  });

  test('strips <svg onload=...> entirely (including content)', () => {
    const out = assertNoDanger('<svg onload="alert(1)">danger</svg>');
    expect(out).not.toContain('danger');
  });

  test('strips <iframe srcdoc=...> entirely', () => {
    assertNoDanger('<iframe srcdoc="<script>alert(1)</script>"></iframe>');
  });

  test('strips <object> and <embed>', () => {
    assertNoDanger('<object data="javascript:alert(1)"></object>');
    assertNoDanger('<embed src="javascript:alert(1)">');
  });

  test('strips <style> blocks', () => {
    const out = assertNoDanger('<style>body{background:url(javascript:alert(1))}</style>');
    expect(out).not.toContain('background');
  });

  test('removes javascript: hrefs but keeps surrounding text', () => {
    const out = assertNoDanger('<a href="javascript:alert(1)">click me</a>');
    expect(out).toContain('click me');
    expect(out).not.toContain('href=');
  });

  test('removes mixed-case javascript: hrefs', () => {
    const out = assertNoDanger('<a href="JaVaScRiPt:alert(1)">click me</a>');
    expect(out).toContain('click me');
    expect(out).not.toContain('href=');
  });

  test('removes data: hrefs', () => {
    const out = assertNoDanger('<a href="data:text/html,<script>alert(1)</script>">click</a>');
    expect(out).toContain('click');
    expect(out).not.toContain('href=');
  });

  test('removes HTML-entity-encoded javascript: hrefs', () => {
    const out = assertNoDanger('<a href="&#106;avascript:alert(1)">click</a>');
    expect(out).toContain('click');
    expect(out).not.toContain('href=');
  });

  test('strips event-handler attributes from allowed tags', () => {
    const out = assertNoDanger('<a href="https://example.com" onclick="alert(1)" onmouseover="alert(2)">x</a>');
    expect(out).toContain('https://example.com');
    expect(out).toContain('>x<');
  });

  test('strips style attributes from allowed tags', () => {
    const out = assertNoDanger('<p style="background:url(javascript:alert(1))">hello</p>');
    expect(out).toContain('hello');
    expect(out).not.toContain('style=');
  });

  test('normalises mixed-case event handlers', () => {
    const out = assertNoDanger('<P OnClick="alert(1)">hello</P>');
    expect(out.toLowerCase()).toContain('hello');
  });
});

describe('sanitizeHtml — safe content preservation', () => {
  test('preserves allowed formatting tags', () => {
    const out = sanitizeHtml('<p>hello <i>world</i> <b>bold</b> <code>x</code> <pre>y</pre></p>');
    expect(out).toContain('<p>');
    expect(out).toContain('<i>');
    expect(out).toContain('<b>');
    expect(out).toContain('<code>');
    expect(out).toContain('<pre>');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  test('preserves http/https links and adds full rel', () => {
    const out = sanitizeHtml('<a href="https://example.com/path">link</a>');
    expect(out).toContain('href="https://example.com/path"');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
    expect(out).toContain('link');
  });

  test('drops disallowed tags including their content', () => {
    const out = sanitizeHtml('<div>outer <span>inner</span></div>');
    expect(out).not.toContain('<div>');
    expect(out).not.toContain('<span>');
    expect(out).not.toContain('outer');
    expect(out).not.toContain('inner');
  });

  test('passes through plain text unchanged', () => {
    expect(sanitizeHtml('just text')).toBe('just text');
  });

  test('decodes entity-encoded hrefs from HN API (&#x2F; for /)', () => {
    const input = '<a href="https:&#x2F;&#x2F;youtu.be&#x2F;Fb0w5OT1U58" rel="nofollow">https:&#x2F;&#x2F;youtu.be&#x2F;Fb0w5OT1U58</a>';
    const out = sanitizeHtml(input);
    expect(out).toContain('href="https://youtu.be/Fb0w5OT1U58"');
    expect(out).toContain('rel="nofollow noopener noreferrer"');
  });
});

describe('htmlToText', () => {
  test('extracts text from formatted HTML', () => {
    expect(htmlToText('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  test('drops script and style content', () => {
    const out = htmlToText('<p>visible</p><script>alert(1)</script><style>.x{}</style>');
    expect(out).toContain('visible');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('.x{}');
  });

  test('decodes HTML entities', () => {
    expect(htmlToText('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  test('a literal </title> in input becomes plain text in output', () => {
    const out = htmlToText('Title</title><script>alert(1)</script>End');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('alert');
    expect(out).toContain('Title');
  });

  test('inserts whitespace between block elements', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one two');
  });
});
