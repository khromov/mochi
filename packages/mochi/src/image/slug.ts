import { extForFormat } from './resize';
import type { ImageRequest } from './types';

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

function dimsLabel(width?: number, height?: number): string {
  if (width && height) {
    return `${width}x${height}`;
  }
  if (width) {
    return `${width}w`;
  }
  if (height) {
    return `${height}h`;
  }
  return '';
}

/** Cosmetic filename only (`my-image-500x500.webp`); the authoritative request travels encrypted in the `payload` query param. */
export function buildImageFilename(req: ImageRequest): string {
  const base = baseName(req.src);
  const dims = dimsLabel(req.width, req.height);
  const name = dims ? `${base}-${dims}` : base;
  return `${name}.${extForFormat(req.format)}`;
}

function extFromSrc(src: string): string {
  const last = lastSegment(src);
  const ext = last.slice(last.lastIndexOf('.') + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) && last.includes('.') ? ext : 'img';
}

/** Cosmetic filename for an original; the served Content-Type, not this extension, is authoritative. */
export function buildOriginalFilename(req: ImageRequest): string {
  return `${baseName(req.src)}-original.${extFromSrc(req.src)}`;
}
