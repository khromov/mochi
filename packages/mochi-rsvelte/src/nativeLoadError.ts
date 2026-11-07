/**
 * The binding's own loader rewrites *every* `require` failure into "npm/pnpm skipped the
 * optional dependency", which misdiagnoses the common Windows case: the prebuilt `.node` is
 * present but links against `VCRUNTIME140.dll`, and Windows reports a missing *dependency* DLL
 * with the same "specified module could not be found" text it uses for a missing file.
 */
export function nativeLoadError(err: unknown): Error {
  const original = err instanceof Error ? err.message : String(err);
  const hint =
    process.platform === 'win32' && original.includes('LoadLibrary')
      ? '\n\nOn Windows this usually means the Microsoft Visual C++ Redistributable is missing — the prebuilt binary is on disk, but the C runtime it links against is not. Install it and re-run:\n\n  winget install --id Microsoft.VCRedist.2015+.x64 -e\n'
      : '';
  return new Error(`[mochi-rsvelte] the @rsvelte native binding failed to load.${hint}\nOriginal error: ${original}`, { cause: err });
}
