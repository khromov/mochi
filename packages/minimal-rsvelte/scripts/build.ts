/**
 * `mochi-framework build`, plus the assertion this whole package exists for.
 *
 * `resolveSvelteCompiler()` never throws: a missing or unloadable rsvelte binary
 * warns and silently compiles with `svelte/compiler`, so a broken install looks
 * exactly like a passing build. CI runs on the three platforms rsvelte ships
 * prebuilt binaries for, so here a fallback is a failure, not a degradation.
 */
import path from 'node:path';

const FALLBACK_MARKERS = ['falling back to svelte/compiler', 'did not export a usable'];
const BACKEND_LINE = /Svelte compiler: rsvelte@/;

// `bun run` rather than the bin directly — .bin shim resolution differs on Windows.
const proc = Bun.spawn(['bun', 'run', 'build:raw'], {
  cwd: path.join(import.meta.dir, '..'),
  stdout: 'pipe',
  stderr: 'pipe',
});

// Tee through to the parent so the ordinary build output is still visible in CI.
const collect = async (stream: ReadableStream<Uint8Array>, sink: NodeJS.WriteStream): Promise<string> => {
  let text = '';
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    text += decoder.decode(chunk, { stream: true });
    sink.write(chunk);
  }
  return text;
};

const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout, process.stdout), collect(proc.stderr, process.stderr), proc.exited]);

if (exitCode !== 0) {
  process.exit(exitCode);
}

const output = stdout + stderr;
const fallback = FALLBACK_MARKERS.find((marker) => output.includes(marker));

if (fallback) {
  console.error(`\n[minimal-rsvelte] build fell back to svelte/compiler ("${fallback}") — the rsvelte binding did not load on this platform.`);
  process.exit(1);
}

if (!BACKEND_LINE.test(output)) {
  console.error('\n[minimal-rsvelte] build never reported `Svelte compiler: rsvelte@…` — it did not compile through rsvelte.');
  process.exit(1);
}

console.log('[minimal-rsvelte] verified: compiled through the rsvelte backend.');
