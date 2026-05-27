import { compile as svelteCompile, preprocess as sveltePreprocess, type CompileOptions, type PreprocessorGroup } from 'svelte/compiler';
import path from 'node:path';
import type { MarkdownConfig } from './types';
import { type HydratableComponent, type ServerIslandComponent } from './svelteAstPreprocess';
import { cachedPreprocessHydratable, createPreprocessCacheStats } from './preprocessCache';
import { mergeCompilerOptions } from './svelteConfig';
import { applyFilter } from './extensions';

export const MARKDOWN_EXTENSIONS = ['.md', '.svx'];
export const MARKDOWN_FILE_FILTER = /\.(md|svx)$/;

export async function applyUserPreprocessors(source: string, filename: string, target: 'server' | 'client', development: boolean): Promise<string> {
  const preprocessors: PreprocessorGroup[] = applyFilter('compile:preprocessors', [], {
    filename,
    target,
    development,
  });
  if (preprocessors.length === 0) {
    return source;
  }
  const result = await sveltePreprocess(source, preprocessors, { filename });
  return result.code;
}

export function formatBuildMessages(
  logs: ReadonlyArray<{
    message: string;
    position?: { file: string; line: number; column: number } | null;
  }>,
): string {
  if (logs.length === 0) {
    return '  <no diagnostic messages>';
  }
  return logs
    .map((l) => {
      const p = l.position;
      const where = p ? `${path.relative(process.cwd(), p.file)}:${p.line}:${p.column}` : '<unknown>';
      return `  ${where} — ${l.message}`;
    })
    .join('\n');
}

export function createMarkdownLoader(opts: {
  markdown: MarkdownConfig;
  target: 'server' | 'client';
  development: boolean;
  cssMap?: Map<string, string>;
  userCompilerOptions: CompileOptions;
  hydration?: {
    fileHydratables: Map<string, HydratableComponent[]>;
    allHydratables: HydratableComponent[];
    allServerIslands: ServerIslandComponent[];
    preprocessCacheStats: ReturnType<typeof createPreprocessCacheStats>;
  };
}) {
  const highlight = opts.markdown.highlight;
  return async (args: { path: string }) => {
    const raw = await Bun.file(args.path).text();
    const compiled = (await opts.markdown.compile(raw, {
      filename: args.path,
      extensions: MARKDOWN_EXTENSIONS,
      rehypePlugins: opts.markdown.rehypePlugins,
      remarkPlugins: opts.markdown.remarkPlugins,
      highlight,
    })) as { code?: unknown } | undefined;
    if (!compiled || typeof compiled.code !== 'string') {
      throw new Error(`markdown.compile returned no output for ${args.path}`);
    }
    let svelteSource = compiled.code;
    if (opts.hydration) {
      const { transformed, hydratables, serverIslands } = cachedPreprocessHydratable(svelteSource, args.path, opts.hydration.preprocessCacheStats);
      opts.hydration.fileHydratables.set(args.path, hydratables);
      opts.hydration.allHydratables.push(...hydratables);
      opts.hydration.allServerIslands.push(...serverIslands);
      svelteSource = transformed;
    }
    const { js, css } = svelteCompile(
      svelteSource,
      mergeCompilerOptions(opts.userCompilerOptions, {
        generate: opts.target,
        filename: args.path,
        ...(opts.target === 'client' ? { dev: opts.development } : {}),
      }),
    );
    if (opts.target === 'server' && css?.code && opts.cssMap) {
      opts.cssMap.set(args.path, css.code);
    }
    return { contents: js.code, loader: 'js' as const };
  };
}
