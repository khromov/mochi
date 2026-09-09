// Ported verbatim from the vendored devalue fork's own test suite (upstream src/base64.test.js); only the imports
// and uvu's API are adapted, via ./uvuShim.ts, so an upstream re-sync stays a diff.
// @ts-nocheck -- upstream test bodies are plain JS and are not written for the repo's strict TS settings.
import { assert, suite } from './uvuShim';
import * as base64 from './src/base64.js';

const strings = ['', 'a', 'ab', 'abc', 'a\r\nb', '\xFF\xFE', '\x00', '\x00\x00\x00', 'the quick brown fox etc', 'é', '中文', '+/', '😎'];

const test = suite('base64_encode_decode');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

for (const string of strings) {
  test(string, () => {
    const data = encoder.encode(string);

    const with_buffer = base64.encode_buffer(data);
    const with_legacy = base64.encode_legacy(data);

    assert.equal(with_buffer, with_legacy);
    assert.equal(decoder.decode(base64.decode_buffer(with_buffer)), string);
    assert.equal(decoder.decode(base64.decode_legacy(with_legacy)), string);

    if (typeof Uint8Array.fromBase64 === 'function') {
      const with_native = base64.encode_native(data);
      assert.equal(decoder.decode(base64.decode_native(with_native)), string);
    }
  });
}

test.run();
