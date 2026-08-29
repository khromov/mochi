import { describe, expect, test } from 'bun:test';
import { applyDefaultSecurityHeaders, generateCspNonce, inlineScript, resolveSecurityHeaders } from './security';
import { initExtensions } from '../extensions';
import type { MochiServeOptions } from '../types';

const baseOptions = { routes: {} } as unknown as MochiServeOptions;

describe('resolveSecurityHeaders', () => {
  test('returns the baseline headers by default, with no X-Frame-Options', () => {
    initExtensions(baseOptions);
    const headers = resolveSecurityHeaders(baseOptions);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['X-Frame-Options']).toBeUndefined();
  });

  test('returns no framework headers when disabled', () => {
    const options = { ...baseOptions, securityHeaders: false } as MochiServeOptions;
    initExtensions(options);
    expect(resolveSecurityHeaders(options)).toEqual({});
  });

  test('honors per-header overrides', () => {
    const options = { ...baseOptions, securityHeaders: { frameOptions: 'DENY', referrerPolicy: false } } as MochiServeOptions;
    initExtensions(options);
    const headers = resolveSecurityHeaders(options);
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBeUndefined();
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  test('runs the security:headers filter so apps can add headers', () => {
    const options = {
      ...baseOptions,
      filters: {
        'security:headers': (headers: Record<string, string>) => ({ ...headers, 'Strict-Transport-Security': 'max-age=63072000' }),
      },
    } as unknown as MochiServeOptions;
    initExtensions(options);
    expect(resolveSecurityHeaders(options)['Strict-Transport-Security']).toBe('max-age=63072000');
  });
});

describe('applyDefaultSecurityHeaders', () => {
  test('adds missing headers without overwriting existing ones', () => {
    const headers = new Headers({ 'X-Frame-Options': 'DENY' });
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

describe('generateCspNonce', () => {
  test('produces a fresh, non-empty value each call', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('inlineScript', () => {
  test('interpolates the nonce at the tag boundary, leaving the body untouched', () => {
    // Real callers inline whole bundles here, and a rewrite pass over the finished string would inject an
    // attribute into any `<script` the JavaScript itself contains.
    const js = 'const marker = "<script>";';
    expect(inlineScript(js, ' nonce="abc"')).toBe(`<script nonce="abc">${js}</script>`);
    expect(inlineScript(js, '')).toBe(`<script>${js}</script>`);
  });
});
