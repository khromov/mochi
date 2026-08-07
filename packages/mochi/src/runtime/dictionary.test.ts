import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  acceptsDcz,
  buildDczResponseBody,
  buildUseAsDictionaryHeader,
  DCZ_MAGIC,
  hashesEqual,
  loadDczCodec,
  parseAvailableDictionary,
  resolveDictionaryOptions,
} from './dictionary';
import type { DictionaryState } from './dictionary';

function stateFor(bytes: Uint8Array): DictionaryState {
  const hash = new Uint8Array(createHash('sha256').update(bytes).digest());
  return { bytes, hash, hashB64: Buffer.from(hash).toString('base64'), useAsDictionaryHeader: 'match="/*"' };
}

describe('resolveDictionaryOptions', () => {
  test('false and undefined disable', () => {
    expect(resolveDictionaryOptions(false, false, '/_mochi')).toBeNull();
    expect(resolveDictionaryOptions(undefined, false, '/_mochi')).toBeNull();
  });

  test('true enables in production with defaults', () => {
    const resolved = resolveDictionaryOptions(true, false, '/_mochi');
    expect(resolved).toEqual({
      routes: ['/'],
      match: '/*',
      matchDest: ['document'],
      id: undefined,
      maxAge: 86_400,
      level: 10,
      maxBytes: 1024 * 1024,
      dictionaryPath: '/_mochi/dictionary',
    });
  });

  test('always disabled in development, even with the object form', () => {
    expect(resolveDictionaryOptions(true, true, '/_mochi')).toBeNull();
    expect(resolveDictionaryOptions({ enabled: true }, true, '/_mochi')).toBeNull();
  });

  test('object form: enabled defaults to true, enabled: false disables', () => {
    expect(resolveDictionaryOptions({}, false, '/_mochi')).not.toBeNull();
    expect(resolveDictionaryOptions({ enabled: false }, false, '/_mochi')).toBeNull();
  });

  test('dictionaryPath follows a custom asset prefix', () => {
    expect(resolveDictionaryOptions(true, false, '/custom')?.dictionaryPath).toBe('/custom/dictionary');
  });
});

describe('buildUseAsDictionaryHeader', () => {
  test('default shape', () => {
    expect(buildUseAsDictionaryHeader({ match: '/*', matchDest: ['document'], id: undefined })).toBe('match="/*", match-dest=("document")');
  });

  test('empty match-dest omits the field', () => {
    expect(buildUseAsDictionaryHeader({ match: '/*', matchDest: [], id: undefined })).toBe('match="/*"');
  });

  test('id is included and strings are escaped', () => {
    expect(buildUseAsDictionaryHeader({ match: '/app/*/main.js', matchDest: [], id: 'dict "v1"' })).toBe('match="/app/*/main.js", id="dict \\"v1\\""');
  });
});

describe('parseAvailableDictionary', () => {
  const hash = createHash('sha256').update('x').digest();

  test('parses a valid structured-field byte sequence', () => {
    const parsed = parseAvailableDictionary(`:${hash.toString('base64')}:`);
    expect(parsed).not.toBeNull();
    expect(Buffer.from(parsed!).equals(hash)).toBe(true);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseAvailableDictionary(`  :${hash.toString('base64')}:  `)).not.toBeNull();
  });

  test('rejects missing header, missing colons, and non-32-byte payloads', () => {
    expect(parseAvailableDictionary(null)).toBeNull();
    expect(parseAvailableDictionary('')).toBeNull();
    expect(parseAvailableDictionary(hash.toString('base64'))).toBeNull();
    expect(parseAvailableDictionary(':abc:')).toBeNull();
    expect(parseAvailableDictionary(`:${Buffer.alloc(16).toString('base64')}:`)).toBeNull();
  });
});

describe('acceptsDcz', () => {
  test('explicit dcz token matches', () => {
    expect(acceptsDcz('gzip, br, zstd, dcb, dcz')).toBe(true);
    expect(acceptsDcz('dcz')).toBe(true);
    expect(acceptsDcz('DCZ')).toBe(true);
  });

  test('q=0 disables it', () => {
    expect(acceptsDcz('dcz;q=0')).toBe(false);
    expect(acceptsDcz('dcz;q=0.0, gzip')).toBe(false);
    expect(acceptsDcz('dcz;q=0.5')).toBe(true);
  });

  test('wildcard and other encodings never select dcz', () => {
    expect(acceptsDcz('*')).toBe(false);
    expect(acceptsDcz('gzip, br')).toBe(false);
    expect(acceptsDcz('')).toBe(false);
    expect(acceptsDcz('dcb')).toBe(false);
  });
});

describe('hashesEqual', () => {
  test('compares byte-wise', () => {
    const a = new Uint8Array([1, 2, 3]);
    expect(hashesEqual(a, new Uint8Array([1, 2, 3]))).toBe(true);
    expect(hashesEqual(a, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(hashesEqual(a, new Uint8Array([1, 2]))).toBe(false);
  });
});

describe('buildDczResponseBody', () => {
  test('emits the RFC 9842 dcz frame: magic, dictionary hash, then a dictionary-decodable zstd stream', async () => {
    const dict = new TextEncoder().encode('<html><body><nav>shared shell markup</nav>'.repeat(20));
    const page = new TextEncoder().encode('<html><body><nav>shared shell markup</nav><main>unique</main></body></html>');
    const state = stateFor(dict);

    const body = await buildDczResponseBody(page, state, 10);

    expect(Array.from(body.slice(0, 8))).toEqual(Array.from(DCZ_MAGIC));
    expect(Buffer.from(body.slice(8, 40)).equals(Buffer.from(state.hash))).toBe(true);

    // Reuse the framework's single init: the lib's init() is not idempotent and corrupts in-flight contexts when re-run.
    await loadDczCodec();
    const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
    const restored = decompressUsingDict(createDCtx(), body.slice(40), dict);
    expect(Buffer.from(restored).equals(Buffer.from(page))).toBe(true);
  });
});
