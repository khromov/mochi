import { describe, expect, test } from 'bun:test';
import { stripMochiDirectives } from './stripMochiDirectives';

const SCRIPT = `<script>
import Widget from './Widget.svelte';
</script>
`;

describe('stripMochiDirectives', () => {
  test('returns source unchanged when no directives are present', () => {
    const source = `${SCRIPT}<Widget title="hi" />`;
    expect(stripMochiDirectives(source)).toBe(source);
  });

  test.each(['mochi:hydrate', 'mochi:hydrate:visible', 'mochi:defer', 'mochi:defer:visible', 'mochi:clientOnly', 'mochi:clientOnly:visible'])(
    'strips %s while keeping other props',
    (directive) => {
      const stripped = stripMochiDirectives(`${SCRIPT}<Widget ${directive} title="hi" count={2} />`);
      expect(stripped).not.toContain('mochi:');
      expect(stripped).toContain('title="hi"');
      expect(stripped).toContain('count={2}');
      expect(stripped).toContain('<Widget');
    },
  );

  test('strips directives with option values', () => {
    const stripped = stripMochiDirectives(`${SCRIPT}<Widget mochi:defer:visible={{ rootMargin: '200px' }} title="hi" />`);
    expect(stripped).not.toContain('mochi:');
    expect(stripped).not.toContain('rootMargin');
    expect(stripped).toContain('title="hi"');
  });

  test('strips combined defer + hydrate on one component', () => {
    const stripped = stripMochiDirectives(`${SCRIPT}<Widget mochi:defer mochi:hydrate title="hi" />`);
    expect(stripped).not.toContain('mochi:');
    expect(stripped).toContain('title="hi"');
  });

  test('keeps children of a directive component', () => {
    const stripped = stripMochiDirectives(`${SCRIPT}<Widget mochi:clientOnly><p>fallback</p></Widget>`);
    expect(stripped).not.toContain('mochi:');
    expect(stripped).toContain('<p>fallback</p>');
  });

  test('strips directives on nested components', () => {
    const source = `${SCRIPT}<div>{#if true}<Widget mochi:hydrate:visible a={1} />{/if}</div>`;
    const stripped = stripMochiDirectives(source);
    expect(stripped).not.toContain('mochi:');
    expect(stripped).toContain('a={1}');
  });
});
