import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { writeSpeculationRules, SpeculationRulesWriteError } from './writeSpeculationRules';
import type { SpeculationRules } from '../runtime/speculationRules';

const RULES: SpeculationRules = { prefetch: [{ where: { href_matches: '/docs/*' }, eagerness: 'moderate' }] };

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function tempEntry(source: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-write-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'index.ts');
  await Bun.write(file, source);
  return file;
}

function parses(source: string): boolean {
  const sf = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, true);
  return (sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;
}

const ENTRY = `import { Mochi } from 'mochi-framework';

await Mochi.serve({
  port: 3000,
  routes: {},
});
`;

describe('writeSpeculationRules', () => {
  it('inserts the key as the last property of the serve object literal', async () => {
    const file = await tempEntry(ENTRY);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.action).toBe('inserted');
    const out = await Bun.file(file).text();
    expect(out).toContain('/docs/*');
    expect(out.indexOf('speculationRules:')).toBeGreaterThan(out.indexOf('routes:'));
    expect(parses(out)).toBe(true);
  });

  it('appends after a spread so the spread cannot override the written rules', async () => {
    const file = await tempEntry(`import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ ...base, routes: {} });\n`);
    await writeSpeculationRules(file, RULES);
    const out = await Bun.file(file).text();
    expect(out.indexOf('speculationRules:')).toBeGreaterThan(out.indexOf('...base'));
    expect(parses(out)).toBe(true);
  });

  it('replaces an existing key instead of duplicating it', async () => {
    const file = await tempEntry(ENTRY);
    await writeSpeculationRules(file, RULES);
    const second = await writeSpeculationRules(file, { prefetch: [{ urls: ['/next'] }] });
    expect(second.action).toBe('replaced');
    const out = await Bun.file(file).text();
    expect(out.match(/speculationRules:/g)?.length).toBe(1);
    expect(out).toContain('/next');
    expect(out).not.toContain('/docs/*');
    expect(parses(out)).toBe(true);
  });

  it('rewrites a shorthand key at its declaration rather than inserting a duplicate', async () => {
    const source = `import { Mochi } from 'mochi-framework';

const speculationRules = { prefetch: [{ urls: ['/old'] }] };

await Mochi.serve({
  port: 3000,
  speculationRules,
  routes: {},
});
`;
    const file = await tempEntry(source);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.action).toBe('replaced');
    const out = await Bun.file(file).text();
    // The shorthand stays; only the value it points at changes, so the const never becomes unused.
    expect(out).toContain('  speculationRules,\n');
    expect(out).toContain('/docs/*');
    expect(out).not.toContain('/old');
    expect(out.match(/speculationRules/g)?.length).toBe(2);
    expect(parses(out)).toBe(true);
  });

  it('rewrites a key given by reference at its declaration', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nconst rules = { prefetch: [{ urls: ['/old'] }] };\nawait Mochi.serve({ speculationRules: rules, routes: {} });\n`;
    const file = await tempEntry(source);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.action).toBe('replaced');
    const out = await Bun.file(file).text();
    expect(out).toContain('speculationRules: rules');
    expect(out).toContain('/docs/*');
    expect(out).not.toContain('/old');
    expect(parses(out)).toBe(true);
  });

  it('throws unresolved-value when the referenced rules are not declared in the file', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nimport { rules } from './rules';\nawait Mochi.serve({ speculationRules: rules, routes: {} });\n`;
    const file = await tempEntry(source);
    const err = await writeSpeculationRules(file, RULES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeculationRulesWriteError);
    expect((err as SpeculationRulesWriteError).code).toBe('unresolved-value');
    expect(await Bun.file(file).text()).toBe(source);
  });

  it('throws unresolved-value on a computed key, which could itself be speculationRules', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ [key]: 1, routes: {} });\n`;
    const file = await tempEntry(source);
    const err = await writeSpeculationRules(file, RULES).catch((e: unknown) => e);
    expect((err as SpeculationRulesWriteError).code).toBe('unresolved-value');
    expect(await Bun.file(file).text()).toBe(source);
  });

  it('inserts into an empty object literal', async () => {
    const file = await tempEntry(`import { Mochi } from 'mochi-framework';\nawait Mochi.serve({});\n`);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.action).toBe('inserted');
    const out = await Bun.file(file).text();
    expect(out).toContain('speculationRules:');
    expect(parses(out)).toBe(true);
  });

  it('edits the first eligible call and reports multiple when several literal serve calls exist', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nawait Mochi.serve({ port: 1 });\nawait Mochi.serve({ port: 2 });\n`;
    const file = await tempEntry(source);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.multipleServeCalls).toBe(true);
    const out = await Bun.file(file).text();
    // The key lands in the first call (before `port: 2`).
    expect(out.indexOf('speculationRules:')).toBeLessThan(out.indexOf('port: 2'));
    expect(out.match(/speculationRules:/g)?.length).toBe(1);
    expect(parses(out)).toBe(true);
  });

  it('reports multiple when the skipped serve call is not an object literal', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nawait Mochi.serve(prodOptions);\nawait Mochi.serve({ port: 2 });\n`;
    const file = await tempEntry(source);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.multipleServeCalls).toBe(true);
  });

  it('throws no-serve and does not mutate when there is no Mochi.serve() call', async () => {
    const source = `console.log('no server here');\n`;
    const file = await tempEntry(source);
    await expect(writeSpeculationRules(file, RULES)).rejects.toMatchObject({ code: 'no-serve' });
    expect(await Bun.file(file).text()).toBe(source);
  });

  it('throws non-literal-arg when serve is passed a variable', async () => {
    const source = `import { Mochi } from 'mochi-framework';\nconst opts = { routes: {} };\nawait Mochi.serve(opts);\n`;
    const file = await tempEntry(source);
    const err = await writeSpeculationRules(file, RULES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SpeculationRulesWriteError);
    expect((err as SpeculationRulesWriteError).code).toBe('non-literal-arg');
    expect(await Bun.file(file).text()).toBe(source);
  });
});
