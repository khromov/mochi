import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { chainInput, powInput, leadingZeroBits, toHex } from './pow';

describe('leadingZeroBits', () => {
  test('counts a partial first byte', () => {
    expect(leadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x80]))).toBe(0);
    expect(leadingZeroBits(new Uint8Array([0x7f]))).toBe(1);
    expect(leadingZeroBits(new Uint8Array([0x01]))).toBe(7);
  });

  test('carries across whole zero bytes', () => {
    expect(leadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
    expect(leadingZeroBits(new Uint8Array([0x00, 0x00, 0x80]))).toBe(16);
  });

  test('counts every bit of an all-zero digest', () => {
    expect(leadingZeroBits(new Uint8Array(4))).toBe(32);
    expect(leadingZeroBits(new Uint8Array(0))).toBe(0);
  });
});

describe('toHex', () => {
  test('pads each byte to two lowercase digits', () => {
    expect(toHex(new Uint8Array([0x00, 0x0f, 0xa0, 0xff]))).toBe('000fa0ff');
    expect(toHex(new Uint8Array(0))).toBe('');
  });

  test("matches node:crypto's digest('hex')", () => {
    const digest = createHash('sha256').update('mochi').digest();
    expect(toHex(new Uint8Array(digest))).toBe(digest.toString('hex'));
  });
});

describe('chain + pow inputs', () => {
  test('are stable and distinct per step', () => {
    expect(chainInput('abc', 1)).toBe('abc:step1');
    expect(chainInput('abc', 2)).toBe('abc:step2');
    expect(powInput('abc', '42')).toBe('abc:42');
  });
});
