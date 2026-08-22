import { highlightCode } from '../lib/highlight.server';
import { isDemoIndex, stripImageConfig, stripStaticDirs, type SourceSpec } from './sourceUtils';

export { isDemoIndex, stripImageConfig, stripStaticDirs, type SourceSpec } from './sourceUtils';

export function delay(minMs: number, maxMs: number = minMs): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Source = { label: string; lang: string; html: string; styleHtml?: string };

const cache = new Map<string, string>();

async function read(path: string): Promise<string> {
  let hit = cache.get(path);
  if (hit !== undefined) {
    return hit;
  }
  hit = await Bun.file(path).text();
  cache.set(path, hit);
  return hit;
}

export async function loadSources(specs: SourceSpec[]): Promise<Source[]> {
  return Promise.all(
    specs.map(async ({ label, path, lang, showImageConfig, showStaticDirs }) => {
      let code = stripDemoWrapper(await read(path));
      if (isDemoIndex(path)) {
        if (!showImageConfig) {
          code = stripImageConfig(code);
        }
        if (!showStaticDirs) {
          code = stripStaticDirs(code);
        }
      }
      const resolvedLang = inferLang(label, lang);
      if (resolvedLang === 'svelte') {
        const { body, style } = splitSvelteStyle(code);
        return {
          label,
          lang: resolvedLang,
          html: await highlightCode(body, resolvedLang),
          ...(style ? { styleHtml: await highlightCode(style, resolvedLang) } : {}),
        };
      }
      return {
        label,
        lang: resolvedLang,
        html: await highlightCode(code, resolvedLang),
      };
    }),
  );
}

const STYLE_RE = /\n<style(?:\s[^>]*)?>[\s\S]*?<\/style>\s*$/;

function splitSvelteStyle(code: string): { body: string; style: string | null } {
  const match = code.match(STYLE_RE);
  if (!match) {
    return { body: code, style: null };
  }
  const body = code.slice(0, match.index!).trimEnd() + '\n';
  const style = match[0].replace(/^\n/, '').trimEnd() + '\n';
  return { body, style };
}

function inferLang(label: string, override?: string): string {
  if (override) {
    return override;
  }
  if (label.endsWith('.svelte')) {
    return 'svelte';
  }
  return 'ts';
}

function stripDemoWrapper(code: string): string {
  if (!/^\s*import\s+DemoPage\s+from/m.test(code)) {
    return code;
  }

  let out = code;
  out = out.replace(/^[^\S\n]*import\s+DemoPage\s+from\s+['"][^'"]+['"];?[^\S\n]*\n?/m, '');
  out = out.replace(/^[^\S\n]*import\s*\{\s*loadSources\s*\}\s*from\s+['"][^'"]+['"];?[^\S\n]*\n?/m, '');
  out = out.replace(/^[^\S\n]*const\s+sources\s*=\s*await\s+loadSources\s*\(\s*\[[\s\S]*?\]\s*\)\s*;?[^\S\n]*\n?/m, '');
  // Multi-page demos hoist their description/sources plumbing into ./shared —
  // hide that import like the inline loadSources call it replaces.
  out = out.replace(/^[^\S\n]*import\s*\{[^}]*\}\s*from\s+['"]\.\/shared['"];?[^\S\n]*\n?/m, '');
  out = out.replace(/<DemoPage\b(?:"[^"]*"|'[^']*'|[^>])*>([\s\S]*?)<\/DemoPage>/, (_, inner) => dedent(inner).trim());
  out = out.replace(/<script(?:\s[^>]*)?>\s*<\/script>\s*\n?/, '');
  out = out.replace(/(<script(?:\s[^>]*)?>)\n[ \t]*\n+/g, '$1\n');
  out = out.replace(/\n[ \t]*\n+([ \t]*<\/script>)/g, '\n$1');
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function dedent(s: string): string {
  const lines = s.split('\n');
  const widths = lines.filter((l) => l.trim()).map((l) => l.match(/^[ \t]*/)![0].length);
  const n = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(n)).join('\n');
}
