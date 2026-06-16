import { describe, expect, test } from 'bun:test';
import { installCustomElementsShim } from './customElementsShim';

describe('installCustomElementsShim', () => {
  test('lets a custom-element definition module evaluate on the server', () => {
    expect(typeof (globalThis as Record<string, unknown>).HTMLElement).toBe('undefined');

    installCustomElementsShim();

    expect(typeof (globalThis as Record<string, unknown>).HTMLElement).toBe('function');

    // The two things a definition module does at module-eval time: extend
    // HTMLElement and call customElements.define(). Neither should throw.
    class XTest extends HTMLElement {}
    expect(() => customElements.define('x-shim-test', XTest)).not.toThrow();
    expect(customElements.get('x-shim-test')).toBe(XTest);
  });

  test('does not define window/document (SSR feature detection stays correct)', () => {
    installCustomElementsShim();

    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  test('is idempotent', () => {
    installCustomElementsShim();
    const first = (globalThis as Record<string, unknown>).HTMLElement;
    installCustomElementsShim();
    expect((globalThis as Record<string, unknown>).HTMLElement).toBe(first);
  });
});
