import { describe, expect, test } from 'bun:test';
import {
  acceptsDcz,
  buildDictionaryBytes,
  DCZ_MAGIC,
  DictionaryStore,
  encodeDcz,
  formatUseAsDictionary,
  frameDcz,
  loadDczCodec,
  parseAvailableDictionary,
  parseDictionaryId,
  resolveCompressionDictionary,
} from './compressionDictionary';

function sha256(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(bytes);
  return new Uint8Array(hasher.digest());
}

function availableDictionaryHeader(dictionary: Uint8Array): string {
  return `:${Buffer.from(sha256(dictionary)).toString('base64')}:`;
}

describe('parseAvailableDictionary', () => {
  const validB64 = Buffer.alloc(32, 7).toString('base64');

  test('accepts a well-formed 32-byte sequence', () => {
    const parsed = parseAvailableDictionary(`:${validB64}:`);
    expect(parsed).toEqual(new Uint8Array(Buffer.alloc(32, 7)));
  });

  test('tolerates surrounding whitespace', () => {
    expect(parseAvailableDictionary(`  :${validB64}:  `)).not.toBeNull();
  });

  test.each([
    [null, 'null'],
    ['', 'empty'],
    ['::', 'empty sequence'],
    [validB64, 'missing colons'],
    [`:${validB64}`, 'missing trailing colon'],
    [`:${Buffer.alloc(16, 7).toString('base64')}:`, 'wrong hash length'],
    [`:${validB64.slice(0, -1)}!:`, 'invalid base64 characters'],
    [`:${validB64.slice(0, -2)}:`, 'truncated base64'],
    [':not base64 at all:', 'garbage'],
  ])('rejects %p (%s)', (value) => {
    expect(parseAvailableDictionary(value as string | null)).toBeNull();
  });
});

describe('parseDictionaryId', () => {
  test('unquotes a structured-field string', () => {
    expect(parseDictionaryId('"dictionary-12345"')).toBe('dictionary-12345');
  });

  test('unescapes backslash escapes', () => {
    expect(parseDictionaryId('"a\\"b\\\\c"')).toBe('a"b\\c');
  });

  test.each([[null], [''], ['unquoted'], ['"unterminated']])('rejects %p', (value) => {
    expect(parseDictionaryId(value as string | null)).toBeNull();
  });
});

describe('formatUseAsDictionary', () => {
  test('match only', () => {
    expect(formatUseAsDictionary({ match: '/*' })).toBe('match="/*"');
  });

  test('match with destinations and id', () => {
    expect(formatUseAsDictionary({ match: '/*', matchDest: ['document', 'frame'], id: 'dict-1' })).toBe('match="/*", match-dest=("document" "frame"), id="dict-1"');
  });

  test('escapes quotes and backslashes', () => {
    expect(formatUseAsDictionary({ match: '/a"b\\c' })).toBe('match="/a\\"b\\\\c"');
  });
});

describe('frameDcz', () => {
  test('emits magic, hash, then the stream', () => {
    const hash = new Uint8Array(32).fill(9);
    const stream = Uint8Array.of(1, 2, 3);
    const framed = frameDcz(stream, hash);
    expect(framed.length).toBe(8 + 32 + 3);
    expect(framed.slice(0, 8)).toEqual(DCZ_MAGIC);
    expect(framed.slice(8, 40)).toEqual(hash);
    expect(framed.slice(40)).toEqual(stream);
  });

  test('rejects a hash that is not 32 bytes', () => {
    expect(() => frameDcz(new Uint8Array(3), new Uint8Array(31))).toThrow('32 bytes');
  });
});

describe('DictionaryStore', () => {
  test('add + getByHex + match round-trip', () => {
    const store = new DictionaryStore();
    const bytes = new TextEncoder().encode('<html>shared shell</html>');
    const entry = store.add(bytes, { id: 'nav' });

    expect(entry.hash).toEqual(sha256(bytes));
    expect(entry.hashHex).toBe(Buffer.from(sha256(bytes)).toString('hex'));
    expect(entry.id).toBe('nav');
    expect(store.getByHex(entry.hashHex)).toBe(entry);
    expect(store.getByHex(entry.hashHex.toUpperCase())).toBe(entry);
    expect(store.match(availableDictionaryHeader(bytes))).toBe(entry);
  });

  test('match misses on an unknown hash or malformed header', () => {
    const store = new DictionaryStore();
    store.add(new TextEncoder().encode('a'));
    expect(store.match(availableDictionaryHeader(new TextEncoder().encode('b')))).toBeNull();
    expect(store.match('garbage')).toBeNull();
    expect(store.match(null)).toBeNull();
  });
});

describe('acceptsDcz', () => {
  test('an explicit dcz token matches', () => {
    expect(acceptsDcz('gzip, br, zstd, dcb, dcz')).toBe(true);
    expect(acceptsDcz('DCZ')).toBe(true);
  });

  test('q=0 disables it', () => {
    expect(acceptsDcz('dcz;q=0')).toBe(false);
    expect(acceptsDcz('dcz;q=0.0, gzip')).toBe(false);
    expect(acceptsDcz('dcz;q=0.5')).toBe(true);
  });

  test('a wildcard never selects dcz', () => {
    expect(acceptsDcz('*')).toBe(false);
    expect(acceptsDcz('gzip, br')).toBe(false);
    expect(acceptsDcz('')).toBe(false);
    expect(acceptsDcz('dcb')).toBe(false);
  });
});

describe('buildDictionaryBytes', () => {
  test('joins pages with a newline', () => {
    const { bytes, skipped } = buildDictionaryBytes(['aa', 'bb'], 1024);
    expect(bytes).toEqual(new TextEncoder().encode('aa\nbb'));
    expect(skipped).toEqual([]);
  });

  test('skips whole pages that would exceed the cap, reporting their index', () => {
    const { bytes, skipped } = buildDictionaryBytes(['aa', 'cccccccccc', 'bb'], 5);
    expect(new TextDecoder().decode(bytes)).toBe('aa\nbb');
    expect(skipped).toEqual([1]);
  });
});

describe('resolveCompressionDictionary', () => {
  test('boolean true is production-only', () => {
    expect(resolveCompressionDictionary(true, true, '/_mochi')).toBeNull();
    expect(resolveCompressionDictionary(true, false, '/_mochi')).toEqual({
      routes: null,
      maxDictionaryBytes: 262144,
      zstdLevel: 10,
      dictionaryPath: '/_mochi/dictionary',
    });
  });

  test('false and undefined stay off', () => {
    expect(resolveCompressionDictionary(false, false, '/_mochi')).toBeNull();
    expect(resolveCompressionDictionary(undefined, false, '/_mochi')).toBeNull();
  });

  test('object form controls each mode and carries overrides', () => {
    const opts = { enabledInProd: false, enabledInDev: true, routes: ['/'], maxDictionaryBytes: 1024, zstdLevel: 3 };
    expect(resolveCompressionDictionary(opts, false, '/_mochi')).toBeNull();
    expect(resolveCompressionDictionary(opts, true, '/_mochi')).toEqual({
      routes: ['/'],
      maxDictionaryBytes: 1024,
      zstdLevel: 3,
      dictionaryPath: '/_mochi/dictionary',
    });
  });

  test('dictionaryPath follows a custom asset prefix', () => {
    expect(resolveCompressionDictionary(true, false, '/custom')?.dictionaryPath).toBe('/custom/dictionary');
  });
});

describe('encodeDcz', () => {
  test('frames a dictionary-decodable zstd stream behind the magic and dictionary hash', async () => {
    const store = new DictionaryStore();
    const dictionary = new TextEncoder().encode('<html><body><nav>shared shell markup</nav>'.repeat(20));
    const entry = store.add(dictionary);
    const payload = new TextEncoder().encode('<html><body><nav>shared shell markup</nav><main>unique</main></body></html>');

    const framed = await encodeDcz(payload, entry, 10);

    expect(framed.slice(0, 8)).toEqual(DCZ_MAGIC);
    expect(framed.slice(8, 40)).toEqual(entry.hash);

    // Reuse the framework's single init: the lib's init() is not idempotent and corrupts in-flight contexts when re-run.
    await loadDczCodec();
    const { createDCtx, decompressUsingDict } = await import('@bokuweb/zstd-wasm');
    expect(Buffer.from(decompressUsingDict(createDCtx(), framed.slice(40), dictionary)).equals(Buffer.from(payload))).toBe(true);
  });
});
