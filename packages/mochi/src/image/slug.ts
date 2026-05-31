import { extForFormat } from './resize';
import type { ImageRequest } from './types';

function slugifyStem(stem: string): string {
  const s = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return s || 'image';
}

function baseName(src: string): string {
  let last: string;
  try {
    last = new URL(src).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    last = src.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? '';
  }
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last;
  return slugifyStem(stem);
}

function dimsLabel(w?: number, h?: number): string {
  if (w && h) {
    return `${w}x${h}`;
  }
  if (w) {
    return `${w}w`;
  }
  if (h) {
    return `${h}h`;
  }
  return '';
}

/**
 * Cosmetic, human-readable filename for an image URL — `<basename>-<dims>.<ext>`,
 * e.g. `my-image-500x500.webp`. Purely for readability / download names; the
 * authoritative request travels in the `payload` + `sig` query params.
 */
export function buildImageFilename(req: ImageRequest): string {
  const base = baseName(req.src);
  const dims = dimsLabel(req.w, req.h);
  const name = dims ? `${base}-${dims}` : base;
  return `${name}.${extForFormat(req.fmt)}`;
}

/** The source URL's own extension (cosmetic), falling back to `img` when absent. */
function extFromSrc(src: string): string {
  let last: string;
  try {
    last = new URL(src).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    last = src.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? '';
  }
  const ext = last.slice(last.lastIndexOf('.') + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) && last.includes('.') ? ext : 'img';
}

/**
 * Cosmetic filename for a full-size original — `<basename>-original.<ext>`,
 * where `<ext>` comes from the source URL (the served Content-Type is
 * authoritative). Purely for readability / download names.
 */
export function buildOriginalFilename(req: ImageRequest): string {
  return `${baseName(req.src)}-original.${extFromSrc(req.src)}`;
}
