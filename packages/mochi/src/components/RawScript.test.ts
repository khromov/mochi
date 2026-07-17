import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ComponentRegistry } from '../compiler/ComponentRegistry';

const COMPONENT_PATH = path.join(import.meta.dir, 'RawScript.svelte');

describe('RawScript', () => {
  let outDir: string;
  let scriptFile: string;
  let registry: ComponentRegistry;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-rawscript-test-'));
    scriptFile = path.join(outDir, 'snippet.js');
    writeFileSync(scriptFile, 'console.log("hello from raw");\n');
    registry = new ComponentRegistry({ development: true, outDir });
    await registry.compile(COMPONENT_PATH);
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  test('inlines the file contents verbatim into the body (absolute src)', async () => {
    const { body } = await registry.renderComponent(COMPONENT_PATH, { src: scriptFile });
    expect(body).toContain('console.log("hello from raw");');
  });

  test('resolves a relative src against the working directory', async () => {
    const relative = path.relative(process.cwd(), scriptFile);
    const { body } = await registry.renderComponent(COMPONENT_PATH, { src: relative });
    expect(body).toContain('console.log("hello from raw");');
  });

  test('inlines a literal `string` instead of reading a file', async () => {
    const { body } = await registry.renderComponent(COMPONENT_PATH, { string: 'console.log("inline literal");' });
    expect(body).toContain('console.log("inline literal");');
  });

  test('throws when neither src nor string is given', async () => {
    await expect(registry.renderComponent(COMPONENT_PATH, {})).rejects.toThrow('exactly one of');
  });

  test('throws when both src and string are given', async () => {
    await expect(registry.renderComponent(COMPONENT_PATH, { src: scriptFile, string: 'x' })).rejects.toThrow('exactly one of');
  });

  test('throws a clear error when the file does not exist', async () => {
    await expect(registry.renderComponent(COMPONENT_PATH, { src: path.join(outDir, 'missing.js') })).rejects.toThrow('could not read');
  });

  test('refuses to hydrate', async () => {
    await expect(registry.renderComponent(COMPONENT_PATH, { src: scriptFile, isHydratable: true })).rejects.toThrow('must not be hydrated');
  });
});
