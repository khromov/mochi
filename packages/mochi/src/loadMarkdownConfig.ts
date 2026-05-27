import path from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { MarkdownConfig } from './types';

export async function loadMarkdownConfig(configPath: string): Promise<MarkdownConfig> {
  const resolved = path.resolve(configPath);
  if (!existsSync(resolved)) {
    throw new Error(`Markdown config not found at ${resolved}. Check your markdownConfigPath option.`);
  }
  const url = `${pathToFileURL(resolved).href}?t=${Date.now()}`;
  const mod = await import(url);
  return (mod.default ?? mod) as MarkdownConfig;
}
