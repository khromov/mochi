// `resolveSvelteCompiler()` falls back to `svelte/compiler` silently on a broken rsvelte install, so this script must fail the build if that happens.
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
  // The framework's own warning normally carries this; repeat it only when it didn't.
  if (process.platform === 'win32' && output.includes('LoadLibrary') && !output.includes('VCRedist')) {
    console.error('The prebuilt binary is on disk but its C runtime is missing. Install it and re-run: winget install --id Microsoft.VCRedist.2015+.x64 -e');
  }
  process.exit(1);
}

if (!BACKEND_LINE.test(output)) {
  console.error('\n[minimal-rsvelte] build never reported `Svelte compiler: rsvelte@…` — it did not compile through rsvelte.');
  process.exit(1);
}

console.log('[minimal-rsvelte] verified: compiled through the rsvelte backend.');
