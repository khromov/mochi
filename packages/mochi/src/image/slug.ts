import { extForFormat } from './resize';
import type { ResolvedImageSize } from './types';

function slugifyStem(stem: string): string {
  const slug = stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || 'image';
}

function lastSegment(src: string): string {
  try {
    return new URL(src).pathname.split('/').filter(Boolean).pop() ?? '';
  } catch {
    return src.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? '';
  }
}

function baseName(src: string): string {
  const last = lastSegment(src);
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last;
  return slugifyStem(stem);
}

/** Cosmetic filename only (`my-image-thumbnail.webp`); the authoritative request travels encrypted in the `p` query param. */
export function buildImageFilename(src: string, size: ResolvedImageSize): string {
  return `${baseName(src)}-${slugifyStem(size.name)}.${extForFormat(size.format)}`;
}

function extFromSrc(src: string): string {
  const last = lastSegment(src);
  const ext = last.slice(last.lastIndexOf('.') + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) && last.includes('.') ? ext : 'img';
}

/** Cosmetic filename for an original; the served Content-Type, not this extension, is authoritative. */
export function buildOriginalFilename(src: string): string {
  return `${baseName(src)}-original.${extFromSrc(src)}`;
}
