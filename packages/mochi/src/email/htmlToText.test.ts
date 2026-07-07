import { describe, expect, test } from 'bun:test';
import { htmlToText } from './mailer';

describe('htmlToText', () => {
  test('strips formatting tags, keeping their text', () => {
    expect(htmlToText('<p>Hi <b>there</b></p>')).toBe('Hi there');
  });

  test('drops <style> contents (not just the tags)', () => {
    expect(htmlToText('<style>.x{color:red}</style><p>Body</p>')).toBe('Body');
  });

  test('drops <script> contents', () => {
    expect(htmlToText('<script>alert(1)</script><p>Body</p>')).toBe('Body');
  });

  test('keeps literal angle brackets in body text', () => {
    expect(htmlToText('<p>if a < b and c > d</p>')).toBe('if a < b and c > d');
  });

  test('decodes entities exactly once — no double-decode', () => {
    // `&amp;lt;` is the escaped text "&lt;", not the tag "<".
    expect(htmlToText('<p>&amp;lt;br&amp;gt;</p>')).toBe('&lt;br&gt;');
  });

  test('matches the pinned integration edge case', () => {
    const html = '<p>if a < b and c > d — use &amp;lt;br&amp;gt; &amp; go</p>';
    expect(htmlToText(html)).toBe('if a < b and c > d — use &lt;br&gt; & go');
  });

  test('decodes named and numeric entities beyond the legacy four', () => {
    expect(htmlToText('<p>&copy; 2026 &mdash; don&#8217;t</p>')).toBe('© 2026 — don’t');
  });

  test('separates adjacent block elements with a space', () => {
    expect(htmlToText('<p>one</p><p>two</p>')).toBe('one two');
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a b');
    expect(htmlToText('a<br>b')).toBe('a b');
  });

  test('flattens nested list items', () => {
    expect(htmlToText('<ul><li>a</li><li>b</li></ul>')).toBe('a b');
  });

  test('separates table cells and rows (email HTML is table-based)', () => {
    expect(htmlToText('<table><tr><td>Name</td><td>Bob</td></tr><tr><td>Age</td><td>30</td></tr></table>')).toBe(
      'Name Bob Age 30',
    );
  });

  test('keeps inline elements contiguous', () => {
    expect(htmlToText('x<span>a</span><b>b</b>y')).toBe('xaby');
  });

  test('collapses whitespace and trims', () => {
    expect(htmlToText('   <p>  hi  </p>  ')).toBe('hi');
  });

  test('collapses a non-breaking space into surrounding whitespace', () => {
    expect(htmlToText('<p>x &nbsp; y</p>')).toBe('x y');
  });

  test('surfaces a link destination after its text, in angle brackets', () => {
    // Angle brackets are the RFC-standard plain-text URL delimiter.
    expect(htmlToText('<a href="http://x" title="t">link</a>')).toBe('link <http://x>');
    expect(htmlToText('<p>Visit <a href="https://example.com/page?a=1&amp;b=2">our site</a> now</p>')).toBe('Visit our site <https://example.com/page?a=1&b=2> now');
  });

  test('omits the destination when it adds nothing', () => {
    // href equal to the visible text, or absent, produces no bracketed suffix.
    expect(htmlToText('<a href="http://x">http://x</a>')).toBe('http://x');
    expect(htmlToText('<a>bare</a>')).toBe('bare');
  });

  test('renders mailto: links as a bare address', () => {
    expect(htmlToText('<a href="mailto:foo@example.com">Email us</a>')).toBe('Email us <foo@example.com>');
    // Text already the address → the scheme-stripped href matches it → no suffix.
    expect(htmlToText('<a href="mailto:foo@example.com">foo@example.com</a>')).toBe('foo@example.com');
    // Query params (subject/body) are dropped — just the address.
    expect(htmlToText('<a href="MAILTO:foo@example.com?subject=Hi">Contact</a>')).toBe('Contact <foo@example.com>');
  });

  test('passes plain text through untouched', () => {
    expect(htmlToText('just text')).toBe('just text');
  });

  test('returns an empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});
