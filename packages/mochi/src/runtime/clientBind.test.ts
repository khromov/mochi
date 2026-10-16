import { describe, expect, test } from 'bun:test';
import { resolveBindOptions, bindActive, computeBindHashes, bindHashEqual, DEFAULT_BIND_HEADERS, type ResolvedBindOptions } from './clientBind';

const FULL: ResolvedBindOptions = { network: true, headers: [...DEFAULT_BIND_HEADERS] };

function hashes(address: string | null, headers: Record<string, string> = {}, bind: ResolvedBindOptions = FULL) {
  return computeBindHashes({ address, headers: new Headers(headers) }, bind)!;
}

describe('resolveBindOptions', () => {
  test('false disables; true and undefined-with-default-on enable the defaults', () => {
    expect(resolveBindOptions(false, true, 'X')).toEqual({ network: false, headers: [] });
    expect(resolveBindOptions(true, false, 'X')).toEqual({ network: true, headers: [...DEFAULT_BIND_HEADERS] });
    expect(resolveBindOptions(undefined, true, 'X')).toEqual({ network: true, headers: [...DEFAULT_BIND_HEADERS] });
    expect(resolveBindOptions(undefined, false, 'X')).toEqual({ network: false, headers: [] });
  });

  test('object form defaults network on and normalizes headers: lowercase, dedupe, sort', () => {
    expect(resolveBindOptions({ headers: ['User-Agent', 'Accept', 'user-agent'] }, false, 'X')).toEqual({ network: true, headers: ['accept', 'user-agent'] });
    expect(resolveBindOptions({ network: false }, false, 'X')).toEqual({ network: false, headers: [...DEFAULT_BIND_HEADERS] });
  });

  test('rejects invalid inputs with the label prefixed', () => {
    expect(() => resolveBindOptions({ network: 'yes' as unknown as boolean }, true, 'Protection')).toThrow('Protection: bind.network must be a boolean');
    expect(() => resolveBindOptions({ headers: ['has space'] }, true, 'Captcha')).toThrow('Captcha: bind.headers contains an invalid header name');
    expect(() => resolveBindOptions({ headers: [''] }, true, 'X')).toThrow('invalid header name');
    expect(() => resolveBindOptions({ headers: 'user-agent' as unknown as string[] }, true, 'X')).toThrow('must be an array');
    expect(() => resolveBindOptions([] as unknown as boolean, true, 'X')).toThrow('bind must be a boolean or an object');
    expect(() => resolveBindOptions(null as unknown as boolean, true, 'X')).toThrow('bind must be a boolean or an object');
  });

  test('the default header list cannot be mutated through the export', () => {
    expect(() => (DEFAULT_BIND_HEADERS as string[]).push('x-injected')).toThrow();
    expect(resolveBindOptions(true, true, 'X').headers).toEqual(['accept-language', 'user-agent']);
  });

  test('bindActive reflects whether any component is on', () => {
    expect(bindActive({ network: false, headers: [] })).toBe(false);
    expect(bindActive({ network: true, headers: [] })).toBe(true);
    expect(bindActive({ network: false, headers: ['user-agent'] })).toBe(true);
  });
});

describe('computeBindHashes', () => {
  test('returns null when binding is inactive', () => {
    expect(computeBindHashes({ address: '1.2.3.4', headers: new Headers() }, { network: false, headers: [] })).toBeNull();
  });

  test('IPv4 addresses in the same /24 share a prefix hash; different /24s do not', () => {
    expect(hashes('1.2.3.4').ph).toBe(hashes('1.2.3.200').ph);
    expect(hashes('1.2.3.4').ph).not.toBe(hashes('1.2.4.1').ph);
    expect(hashes('1.2.3.4').f).toBe(4);
  });

  test('IPv6 addresses in the same /64 share a prefix hash; different /64s do not', () => {
    expect(hashes('2001:db8:1:2::1').ph).toBe(hashes('2001:db8:1:2:ffff::9').ph);
    expect(hashes('2001:db8:1:2::1').ph).not.toBe(hashes('2001:db8:1:3::1').ph);
    expect(hashes('2001:db8:1:2::1').f).toBe(6);
  });

  test('a v4-mapped IPv6 address folds to its IPv4 form', () => {
    expect(hashes('::ffff:1.2.3.4')).toEqual(hashes('1.2.3.4'));
  });

  test('null and unparseable addresses share the stable no-address marker', () => {
    expect(hashes(null).f).toBe(0);
    expect(hashes('not-an-ip')).toEqual(hashes(null));
    expect(hashes(null).ph).not.toBe(hashes('1.2.3.4').ph);
  });

  test('an IPv4 and an IPv6 prefix never hash alike even textually', () => {
    // The family is mixed into the prefix hash, so cross-family collisions are structural, not accidental.
    expect(hashes('1.2.3.4').ph).not.toBe(hashes('2001:db8:1:2::1').ph);
  });

  test('bound header values feed the header hash; missing headers hash as empty', () => {
    const ua = { 'user-agent': 'A/1.0', 'accept-language': 'en' };
    expect(hashes('1.2.3.4', ua).hh).toBe(hashes('9.9.9.9', ua).hh);
    expect(hashes('1.2.3.4', ua).hh).not.toBe(hashes('1.2.3.4', { ...ua, 'user-agent': 'B/2.0' }).hh);
    expect(hashes('1.2.3.4', {}).hh).not.toBe(hashes('1.2.3.4', ua).hh);
    expect(hashes('1.2.3.4', {}).hh).toBe(hashes('9.9.9.9', {}).hh);
  });

  test('NUL delimiting prevents concatenation collisions between name/value pairs', () => {
    const bind: ResolvedBindOptions = { network: false, headers: ['x-a', 'x-ab'] };
    const a = computeBindHashes({ address: null, headers: new Headers({ 'x-a': 'b1', 'x-ab': '1' }) }, bind)!;
    const b = computeBindHashes({ address: null, headers: new Headers({ 'x-a': 'b', 'x-ab': '11' }) }, bind)!;
    expect(a.hh).not.toBe(b.hh);
  });
});

describe('bindHashEqual', () => {
  test('equal, unequal, and length-mismatched inputs', () => {
    expect(bindHashEqual('abc', 'abc')).toBe(true);
    expect(bindHashEqual('abc', 'abd')).toBe(false);
    expect(bindHashEqual('abc', 'abcd')).toBe(false);
    expect(bindHashEqual('', '')).toBe(true);
  });
});
