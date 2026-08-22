import { readFileSync, writeFileSync } from 'node:fs';
import { logger } from '../utils/log';

export interface SvelteCheckPatchResult {
  /** Whether the file was modified on this call. */
  patched: boolean;
  /** Why nothing was written (already patched, not installed, anchor missing). */
  reason?: string;
}

// Marker proving the patch is already applied (and the snippet we inject).
const MOCHI_MARKER = "attr.name.startsWith('mochi:')";
// Anchor proving we're inside svelte2tsx's `handleAttribute`: the `--` CSS-prop
// branch is unique to that function. We match by surrounding code rather than
// line numbers so the injection survives svelte-check version bumps.
const CSS_ANCHOR = '__sveltets_2_cssProp';
const ADD_PROP = 'element.addProp(name, value);';

/**
 * Inject mochi's custom-attribute branch into svelte-check's bundled svelte2tsx
 * source. Pure (no I/O) so it can be unit-tested against a fixture. Returns the
 * possibly-transformed source plus a reason when it declines to change anything.
 */
export function injectMochiBranch(source: string): { source: string; changed: boolean; reason?: string } {
  if (source.includes(MOCHI_MARKER)) {
    return { source, changed: false, reason: 'already patched' };
  }

  const cssIdx = source.indexOf(CSS_ANCHOR);
  if (cssIdx === -1) {
    return { source, changed: false, reason: 'handleAttribute anchor not found' };
  }

  // The `element.addProp(name, value);` that closes the component-attribute
  // branch sits right after the `--` CSS-prop block; we insert ahead of it.
  const addPropIdx = source.indexOf(ADD_PROP, cssIdx);
  if (addPropIdx === -1) {
    return { source, changed: false, reason: 'addProp anchor not found' };
  }

  const lineStart = source.lastIndexOf('\n', addPropIdx) + 1;
  const indent = source.slice(lineStart, addPropIdx);
  const inner = indent + '    ';
  const branch =
    `${indent}else if (attr.name.startsWith('mochi:')) {\n` +
    `${inner}name.unshift('...__sveltets_2_empty({');\n` +
    `${inner}if (!value) {\n` +
    `${inner}    value = ['__sveltets_2_any()'];\n` +
    `${inner}}\n` +
    `${inner}value.push('})');\n` +
    `${indent}}\n`;

  return { source: source.slice(0, lineStart) + branch + source.slice(lineStart), changed: true };
}

/**
 * Make the consuming project's installed svelte-check tolerate mochi's custom
 * template attributes (`mochi:hydrate`, `mochi:defer`, …). svelte2tsx reads the
 * raw `.svelte` source, so neither preprocessors nor ambient types can fix this
 * — the bundle itself must carry the branch. Self-healing and idempotent: safe
 * to run on every dev start / `mochi-framework prepare`. Never throws.
 */
export function ensureSvelteCheckPatched(): SvelteCheckPatchResult {
  let entry: string;
  try {
    entry = Bun.resolveSync('svelte-check', process.cwd());
  } catch {
    return { patched: false, reason: 'svelte-check not installed' };
  }

  let source: string;
  try {
    source = readFileSync(entry, 'utf8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not read svelte-check at ${entry}: ${msg}`);
    return { patched: false, reason: 'read failed' };
  }

  const { source: next, changed, reason } = injectMochiBranch(source);
  if (!changed) {
    if (reason && reason !== 'already patched') {
      logger.warn(`Could not patch svelte-check for mochi: attributes (${reason}). Custom mochi: attributes may report type errors. svelte-check at: ${entry}`);
    }
    return { patched: false, reason };
  }

  try {
    writeFileSync(entry, next);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Could not write svelte-check patch to ${entry}: ${msg}`);
    return { patched: false, reason: 'write failed' };
  }

  logger.debug(`Patched svelte-check for mochi: attributes at ${entry}`);
  return { patched: true };
}
