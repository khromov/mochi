import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { compile, compileModule } from 'svelte/compiler';
import { ComponentRegistry } from './ComponentRegistry';
import { minifyJsChunks } from './jsMinifier';
import { findOxcDroppedCalls, formatOxcDroppedCall, OXC_DROPPED_CALLS, oxcDroppedCallReplacement } from './oxcDroppedCalls';
import { logger } from '../utils/log';

const track = (body: string) => `export function track(o, p, run) { ${body} run(); }`;

async function survivesOxc(statement: string): Promise<boolean> {
  const [empty, out] = await minifyJsChunks([
    { fileName: 'empty.js', code: track('') },
    { fileName: 'statement.js', code: track(statement) },
  ]);
  return out !== empty;
}

function readsItsArgument(callee: string): boolean {
  let reads = 0;
  const proxy = new Proxy([1, 2], {
    get(target, key, receiver) {
      reads += 1;
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  try {
    new Function('o', `${callee}(o)`)(proxy);
  } catch {
    // A throwing coercion has still read the proxy.
  }
  return reads > 0;
}

describe('the list of calls oxc deletes', () => {
  test.each([...OXC_DROPPED_CALLS.keys()])('%s(o) is deleted by oxc and reads its argument', async (callee) => {
    expect(await survivesOxc(`${callee}(o);`)).toBe(false);
    expect(readsItsArgument(callee)).toBe(true);
  });

  test('no other global callable is both deleted and a read', async () => {
    const skip = new Set([
      'eval',
      'Function',
      'setTimeout',
      'setInterval',
      'setImmediate',
      'queueMicrotask',
      'fetch',
      'alert',
      'confirm',
      'prompt',
      'require',
      'gc',
      'reportError',
      'postMessage',
    ]);
    const globals = globalThis as unknown as Record<string, unknown>;
    const candidates = Object.getOwnPropertyNames(globals).filter((name) => /^[A-Za-z]\w*$/.test(name) && typeof globals[name] === 'function' && !skip.has(name));
    for (const namespace of ['Math', 'Number', 'String', 'Object', 'Array', 'JSON', 'Reflect', 'Symbol', 'BigInt', 'Date', 'Boolean', 'URL']) {
      const object = globals[namespace] as Record<string, unknown>;
      candidates.push(
        ...Object.getOwnPropertyNames(object)
          .filter((key) => /^[A-Za-z]\w*$/.test(key) && typeof object[key] === 'function')
          .map((key) => `${namespace}.${key}`),
      );
    }
    const empty = track('');
    const outputs = await minifyJsChunks([{ fileName: 'empty.js', code: empty }, ...candidates.map((callee, i) => ({ fileName: `c${i}.js`, code: track(`${callee}(o);`) }))]);

    const deletedReads = candidates.filter((callee, i) => outputs[i + 1] === outputs[0] && readsItsArgument(callee));

    expect(deletedReads.sort()).toEqual([...OXC_DROPPED_CALLS.keys()].sort());
  });

  // What decides whether the wrapper is deleted: an identifier or literal argument is side-effect free to oxc, while
  // the call or property read Svelte compiles a signal access to is not.
  test.each([
    ['String(o);', false],
    ['String(o, 1);', false],
    ['parseInt(o, 10);', false],
    ['void String(o);', false],
    ['String(o), String(p);', false],
    ['String(run(o));', true],
    ['String(o.a);', true],
    ['String(...o);', true],
  ])('%s survives: %p', async (statement, survives) => {
    expect(await survivesOxc(statement)).toBe(survives);
  });

  test.each(['`${o}`;', 'Number(o);', 'JSON.stringify(o);', '$state.snapshot(o);', 'o.length;'])('the suggested replacement %s survives', async (statement) => {
    expect(await survivesOxc(statement)).toBe(true);
  });
});

function find(script: string, filename = 'Component.svelte') {
  const source = filename.endsWith('.svelte') ? `<script lang="ts">\n${script}\n</scr${'ipt>'}\n<p>static</p>\n` : script;
  const compiled = filename.endsWith('.svelte')
    ? compile(source, { generate: 'client', filename }).js.code
    : compileModule(new Bun.Transpiler({ loader: 'ts' }).transformSync(source), { generate: 'client', filename }).js.code;
  return findOxcDroppedCalls(source, filename, compiled);
}

describe('findOxcDroppedCalls', () => {
  test('finds the bare String() call in an $effect, on its own line', () => {
    const found = find(`let filters = $state(['red']);\nlet page = $state(1);\n$effect(() => {\n  String(filters); // track\n  page = 1;\n});\nfunction next() { page++; }`);

    expect(found).toEqual([{ line: 5, call: 'String(filters)', callee: 'String', values: ['filters'], rune: '$effect' }]);
  });

  test.each([...OXC_DROPPED_CALLS.keys()])('finds %s(items)', (callee) => {
    expect(find(`let items = $state([1]);\n$effect(() => {\n  ${callee}(items);\n});`).map((d) => d.callee)).toEqual([callee]);
  });

  test.each([
    ['$effect.pre', '$effect.pre(() => {\n  String(items);\n});'],
    ['$derived.by', 'const total = $derived.by(() => {\n  String(items);\n  return 1;\n});'],
    ['$effect', '$effect(() => {\n  const read = () => {\n    String(items);\n  };\n  read();\n});'],
    ['$effect', '$effect(() => {\n  void String(items);\n});'],
    ['$effect', '$effect(() => {\n  String(items), console.log(1);\n});'],
    ['$effect', '$effect(() => {\n  parseInt(items, 10);\n});'],
  ])('finds the call inside %s: %s', (rune, body) => {
    expect(find(`let items = $state([1]);\n${body}`).map((d) => d.rune)).toEqual([rune]);
  });

  test.each([
    '`${items}`;',
    "items + '';",
    'items.toString();',
    'items.join();',
    'Number(items);',
    '+items;',
    'JSON.stringify(items);',
    'items.length;',
    '[...items];',
    'Object.keys(items);',
    '$state.snapshot(items);',
  ])('stays silent for the surviving idiom %s', (statement) => {
    expect(find(`let items = $state([1]);\n$effect(() => {\n  ${statement}\n});`)).toEqual([]);
  });

  test.each([
    'const s = String(items);\n  console.log(s);',
    'console.log(String(items));',
    'if (String(items) === "1") console.log(1);',
    'String(items).length;',
    'String(items.length);',
    'String(items[0]);',
    'String(read(items));',
  ])('stays silent when the result is used or the argument is not a bare value: %s', (body) => {
    expect(find(`let items = $state([1]);\nconst read = (v: unknown) => v;\n$effect(() => {\n  ${body}\n});`)).toEqual([]);
  });

  test('stays silent when the result is returned', () => {
    expect(find(`let items = $state([1]);\nconst label = $derived.by(() => {\n  return String(items);\n});\n$effect(() => { console.log(label); });`)).toEqual([]);
  });

  test('stays silent outside a reactive callback', () => {
    expect(find(`let items = $state([1]);\nString(items);\nfunction onclick() {\n  String(items);\n}\n$effect(() => { console.log(onclick); });`)).toEqual([]);
  });

  // Svelte compiles each of these to `$.get(x)` or a prop read, and oxc keeps the whole call around that.
  test.each([
    ['reassigned $state', 'let count = $state(0);\nfunction bump() { count += 1; }'],
    ['$state.raw that is reassigned', 'let count = $state.raw([0]);\nfunction bump() { count = [1]; }'],
    ['$derived', 'let n = $state(0);\nfunction bump() { n += 1; }\nconst count = $derived(n * 2);'],
    ['a prop', 'let { count }: { count: number } = $props();'],
  ])('stays silent for %s, whose signal read keeps the call alive', async (_label, declaration) => {
    const script = `${declaration}\n$effect(() => {\n  String(count);\n});`;
    expect(find(script)).toEqual([]);

    // The claim the silence rests on: the compiled call really does survive the oxc pass.
    const compiled = compile(`<script lang="ts">\n${script}\n</scr${'ipt>'}`, { generate: 'client', filename: 'C.svelte' }).js.code;
    const [out] = await minifyJsChunks([{ fileName: 'c.js', code: compiled }]);
    expect(out!).toContain('String(');
  });

  test('finds calls in a rune module, with TypeScript syntax and the right line', () => {
    const found = find(
      `export function watch<T>(values: T[]): void {\n  $effect(() => {\n    encodeURIComponent(values as unknown as string);\n    isNaN(values!);\n  });\n}\n`,
      'watch.svelte.ts',
    );

    expect(found).toEqual([
      { line: 3, call: 'encodeURIComponent(values as unknown as string)', callee: 'encodeURIComponent', values: ['values'], rune: '$effect' },
      { line: 4, call: 'isNaN(values!)', callee: 'isNaN', values: ['values'], rune: '$effect' },
    ]);
  });

  test('a source that does not parse is left to the compiler', () => {
    expect(findOxcDroppedCalls('<script>$effect(() => { String(x) </scr' + 'ipt>', 'Broken.svelte', 'String(x)')).toEqual([]);
  });
});

describe('formatOxcDroppedCall', () => {
  test('names the file and line, quotes the call, explains the loss and suggests the template literal for String()', () => {
    const message = formatOxcDroppedCall('src/Filters.svelte', { line: 7, call: 'String(filters)', callee: 'String', values: ['filters'], rune: '$effect' });

    expect(message).toBe(
      "src/Filters.svelte:7 — `String(filters)` is a bare call inside $effect, and the 'oxc' minifier removes it, so the effect stops reacting to `filters`. " +
        'Write `` `${filters}`; `` instead (same reads, survives oxc); `JSON.stringify(filters);`, `$state.snapshot(filters);` or a property read such as `filters.length;` also work.',
    );
  });

  test('suggests Number() for a numeric coercion, once per value, and names the derived', () => {
    const dropped = { line: 3, call: 'Math.max(a, b)', callee: 'Math.max', values: ['a', 'b'], rune: '$derived.by' };

    expect(oxcDroppedCallReplacement(dropped)).toBe('Number(a); Number(b);');
    expect(formatOxcDroppedCall('a.svelte.ts', dropped)).toContain('so the derived stops reacting to `a`, `b`. Write `Number(a); Number(b);` instead');
  });
});

describe('compile-time warning', () => {
  const PAGE = path.join(import.meta.dir, '..', '__fixtures__', 'oxc-dropped-calls', 'Page.svelte');
  const outDirs: string[] = [];
  let savedEnv: string | undefined;

  beforeAll(() => {
    savedEnv = process.env.MOCHI_MINIFIER;
    delete process.env.MOCHI_MINIFIER;
  });

  afterAll(() => {
    if (savedEnv !== undefined) {
      process.env.MOCHI_MINIFIER = savedEnv;
    }
    for (const dir of outDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  async function warningsFor(minifier: 'bun' | 'oxc', development: boolean): Promise<string[]> {
    const outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', `.mochi-oxc-dropped-${minifier}-`));
    outDirs.push(outDir);
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const registry = new ComponentRegistry({ development, debugBar: false, outDir, minifier });
      await registry.compileAll([PAGE]);
      await registry.compileAll([PAGE], { force: true });
      return warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("'oxc' minifier removes it"));
    } finally {
      warn.mockRestore();
    }
  }

  test.each([false, true])("'oxc' warns once per call for a component and a rune module (development: %p)", async (development) => {
    const warnings = (await warningsFor('oxc', development)).sort();

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toStartWith('src/__fixtures__/oxc-dropped-calls/Filters.svelte:7 — `String(filters)` is a bare call inside $effect');
    expect(warnings[0]).toContain('Write `` `${filters}`; `` instead');
    expect(warnings[1]).toStartWith('src/__fixtures__/oxc-dropped-calls/tracker.svelte.ts:3 — `encodeURIComponent(values as unknown as string)` is a bare call inside $effect.pre');
    expect(warnings.join('\n')).not.toContain('\\');
  });

  test("'bun' never warns", async () => {
    expect(await warningsFor('bun', false)).toEqual([]);
  });
});
