import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// mochi publishes source, so a consumer's tsc/svelte-check type-checks transports.ts. nodemailer
// ships no bundled types and @types/nodemailer is not a runtime dep, so a *literal*
// import('nodemailer') leaks a TS7016 into every consumer that never touches email (see #192 and
// transports.ts). This guard reproduces a consumer's resolution and asserts the leak is gone.
//
// It can't just point tsc at the real transports.ts: the monorepo's node_modules still carries a
// stray @types/nodemailer, which satisfies resolution from the file's real location no matter what
// `types`/`typeRoots` say. So we copy the real source into an isolated /tmp project whose only
// nodemailer is an untyped fake and which has no @types anywhere up its chain — exactly a consumer.
// The two local imports are stubbed loosely; only the nodemailer specifier's resolution is under test.

const TRANSPORTS_SRC = readFileSync(path.join(import.meta.dir, 'transports.ts'), 'utf8');
const TSC = path.join(import.meta.dir, '..', '..', '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');

const TYPES_STUB = `
export class EmailError extends Error {
  constructor(message?: string, options?: unknown) {
    super(message);
    void options;
  }
}
export type MochiEmailResult = { transport: string; [k: string]: unknown };
export type MochiEmailTransportConfig = any;
export type ResolvedEmailMessage = any;
`;
const DEVOUTBOX_STUB = `export function recordDevEmail(_message: unknown): void {}`;

async function typecheckIsolated(source: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'mochi-nm-guard-'));
  try {
    writeFileSync(path.join(dir, 'transports.ts'), source);
    writeFileSync(path.join(dir, 'types.ts'), TYPES_STUB);
    writeFileSync(path.join(dir, 'devOutbox.ts'), DEVOUTBOX_STUB);
    // An untyped nodemailer, like a real consumer's install: a package with a .js entry and no types,
    // and — crucially — no @types/nodemailer anywhere above this /tmp dir.
    const nm = path.join(dir, 'node_modules', 'nodemailer');
    mkdirSync(path.join(nm, 'lib'), { recursive: true });
    writeFileSync(path.join(nm, 'package.json'), JSON.stringify({ name: 'nodemailer', version: '9.0.0', main: 'lib/nodemailer.js' }));
    writeFileSync(path.join(nm, 'lib', 'nodemailer.js'), 'module.exports = { createTransport() {} };');
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { noImplicitAny: true, strict: true, module: 'esnext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true, types: [], typeRoots: [] },
        files: ['transports.ts'],
      }),
    );

    const proc = Bun.spawn([process.execPath, TSC, '-p', path.join(dir, 'tsconfig.json')], { stdout: 'pipe', stderr: 'pipe' });
    const [, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return stdout + stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('email SMTP transport type leak (consumer view)', () => {
  it('does not force consumers to resolve nodemailer types', async () => {
    const output = await typecheckIsolated(TRANSPORTS_SRC);
    // Narrow on purpose: unrelated diagnostics from the stubbed local imports must not make the guard
    // flaky — it fails only when the nodemailer type resolution leak returns.
    expect(output).not.toContain('TS7016');
    expect(output.toLowerCase()).not.toContain('nodemailer');
  });

  it('would fail if the nodemailer import used a literal specifier (guard self-check)', async () => {
    // Prove the fixture actually reproduces the leak, so the assertion above is meaningful and not
    // vacuously green. A literal import('nodemailer') in this same isolated project must trip TS7016.
    const withLiteral = TRANSPORTS_SRC.replace(
      /const nodemailerSpecifier = 'nodemailer';\s*\n\s*nodemailer = \(await import\(nodemailerSpecifier\)\)/,
      "nodemailer = (await import('nodemailer'))",
    );
    expect(withLiteral).toContain("await import('nodemailer')");
    const output = await typecheckIsolated(withLiteral);
    expect(output).toContain('TS7016');
  });
});
