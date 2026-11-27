import { describe, expect, test } from 'bun:test';
import { addSecurityHeaders, applyDefaultSecurityHeaders, resolveSecurityHeaders } from './security';
import { initExtensions } from '../extensions';
import type { MochiServeOptions } from '../types';

const baseOptions = { routes: {} } as unknown as MochiServeOptions;

describe('resolveSecurityHeaders', () => {
  test('returns the baseline headers by default, with no X-Frame-Options', () => {
    initExtensions(baseOptions);
    expect(resolveSecurityHeaders(baseOptions)).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });

  test('returns no framework headers when disabled', () => {
    const options = { ...baseOptions, securityHeaders: false } as MochiServeOptions;
    initExtensions(options);
    expect(resolveSecurityHeaders(options)).toEqual({});
  });

  test('honors per-header overrides', () => {
    const options = { ...baseOptions, securityHeaders: { frameOptions: 'DENY', referrerPolicy: false, contentTypeOptions: false } } as MochiServeOptions;
    initExtensions(options);
    expect(resolveSecurityHeaders(options)).toEqual({ 'X-Frame-Options': 'DENY' });
  });

  test('runs the security:headers filter so apps can add or drop headers', () => {
    const options = {
      ...baseOptions,
      filters: {
        'security:headers': ({ 'Referrer-Policy': _dropped, ...headers }: Record<string, string>) => ({ ...headers, 'Strict-Transport-Security': 'max-age=63072000' }),
      },
    } as unknown as MochiServeOptions;
    initExtensions(options);
    expect(resolveSecurityHeaders(options)).toEqual({ 'X-Content-Type-Options': 'nosniff', 'Strict-Transport-Security': 'max-age=63072000' });
  });
});

describe('applyDefaultSecurityHeaders', () => {
  test('adds missing headers without overwriting existing ones', () => {
    const headers = new Headers({ 'x-frame-options': 'DENY' });
    applyDefaultSecurityHeaders(headers, { 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff' });
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  test('leaves X-Frame-Options off a response that publishes a frame-ancestors allow-list', () => {
    const headers = new Headers({ 'Content-Security-Policy': "frame-ancestors 'self' https://mochi.fast" });
    applyDefaultSecurityHeaders(headers, { 'X-Frame-Options': 'SAMEORIGIN', 'X-Content-Type-Options': 'nosniff' });
    expect(headers.get('X-Frame-Options')).toBeNull();
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('addSecurityHeaders', () => {
  test('re-wraps a response whose headers reject mutation, keeping status and body', async () => {
    const original = new Response('body', { status: 418, statusText: 'Teapot', headers: { 'Content-Type': 'text/plain' } });
    const guarded = new Headers(original.headers);
    guarded.set = () => {
      throw new TypeError('immutable');
    };
    Object.defineProperty(original, 'headers', { value: guarded });

    const result = addSecurityHeaders(original, { 'X-Content-Type-Options': 'nosniff' });
    expect(result).not.toBe(original);
    expect(result.status).toBe(418);
    expect(result.statusText).toBe('Teapot');
    expect(result.headers.get('Content-Type')).toBe('text/plain');
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await result.text()).toBe('body');
  });
});
