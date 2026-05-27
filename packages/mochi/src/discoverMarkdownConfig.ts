import { existsSync } from 'node:fs';
import path from 'node:path';

const CONFIG_NAMES = ['mdsvex.config.ts', 'mdsvex.config.js'];

export function discoverMarkdownConfig(cwd = process.cwd()): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidate = path.resolve(cwd, name);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
