import { describe, expect, test } from 'bun:test';
import { CONFIGURABLE_PANELS, canToggle, parseHiddenPanels } from './panelSettings';

describe('parseHiddenPanels', () => {
  test('returns empty array for null', () => {
    expect(parseHiddenPanels(null)).toEqual([]);
  });

  test('returns empty array for invalid JSON', () => {
    expect(parseHiddenPanels('not json{')).toEqual([]);
  });

  test('returns empty array for non-array JSON', () => {
    expect(parseHiddenPanels('{"info":true}')).toEqual([]);
    expect(parseHiddenPanels('"info"')).toEqual([]);
    expect(parseHiddenPanels('42')).toEqual([]);
  });

  test('parses a valid hidden list', () => {
    expect(parseHiddenPanels('["request","info"]')).toEqual(['request', 'info']);
  });

  test('filters unknown ids', () => {
    expect(parseHiddenPanels('["request","nope",3,null]')).toEqual(['request']);
  });

  test('dedupes entries', () => {
    expect(parseHiddenPanels('["info","info","request"]')).toEqual(['info', 'request']);
  });

  test('resets when every panel would be hidden', () => {
    expect(parseHiddenPanels(JSON.stringify([...CONFIGURABLE_PANELS]))).toEqual([]);
  });
});

describe('canToggle', () => {
  test('un-hiding is always allowed', () => {
    expect(canToggle(['info'], 'info')).toBe(true);
  });

  test('hiding is allowed while another panel stays visible', () => {
    expect(canToggle([], 'info')).toBe(true);
    expect(canToggle(['info', 'request', 'islands'], 'warnings')).toBe(true);
  });

  test('hiding the last visible panel is rejected', () => {
    const allButBundles = CONFIGURABLE_PANELS.filter((p) => p !== 'bundles');
    expect(canToggle(allButBundles, 'bundles')).toBe(false);
  });
});
