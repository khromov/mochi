import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { writeSpeculationRules, SpeculationRulesWriteError } from './writeSpeculationRules';
import type { SpeculationRules } from '../runtime/speculationRules';

const RULES: SpeculationRules = { prefetch: [{ where: { href_matches: '/docs/*' }, eagerness: 'moderate' }] };

async function tempEntry(source: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-write-'));
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
  it('inserts the key as the first property of the serve object literal', async () => {
    const file = await tempEntry(ENTRY);
    const result = await writeSpeculationRules(file, RULES);
    expect(result.action).toBe('inserted');
    const out = await Bun.file(file).text();
    expect(out).toContain('speculationRules:');
    expect(out).toContain('/docs/*');
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
