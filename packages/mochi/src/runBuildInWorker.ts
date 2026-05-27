import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workers', 'bun-build-worker.ts');

export interface SerializableBuildOptions {
  entrypoints: string[];
  target?: 'browser' | 'bun';
  conditions?: string[];
  external?: string[];
  splitting?: boolean;
  outdir?: string;
  naming?: Record<string, string> | string;
  metafile?: boolean;
  minify?: boolean;
  define?: Record<string, string>;
  publicPath?: string;
  files?: Record<string, string>;
}

export interface SsrPluginConfig {
  development: boolean;
  userCompilerOptions: Record<string, unknown>;
  frameworkDir: string;
  markdownConfigPath?: string;
}

export interface ClientPluginConfig {
  development: boolean;
  userCompilerOptions: Record<string, unknown>;
  frameworkDir: string;
  debugBarEnabled: boolean;
  debugBarDir: string;
  cookiesClientPath: string;
  enhanceClientPath: string;
  hydratableIslandPath: string;
  markdownConfigPath?: string;
}

export interface BuildRequest {
  kind: 'simple' | 'ssr' | 'client';
  buildOptions: SerializableBuildOptions;
  pluginConfig?: SsrPluginConfig | ClientPluginConfig;
}

export interface SerializedOutput {
  path: string;
  text: string;
  kind: string;
}

export interface SsrSideEffects {
  cssMap: [string, string][];
  importedCssPaths: string[];
  fileHydratables: [string, { name: string; resolvedPath: string }[]][];
  allHydratables: { name: string; resolvedPath: string }[];
  allServerIslands: { name: string; resolvedPath: string }[];
  preprocessCacheStats: { hits: number; misses: number };
}

export interface BuildResponse {
  success: boolean;
  logs: { message: string; position?: { file: string; line: number; column: number } | null }[];
  outputs: SerializedOutput[];
  metafile?: Record<string, unknown>;
  sideEffects?: SsrSideEffects;
}

const DEFAULT_TIMEOUT = 60_000;

export function runBuildInWorker(request: BuildRequest, timeout = DEFAULT_TIMEOUT): Promise<BuildResponse> {
  return new Promise<BuildResponse>((resolve, reject) => {
    const worker = new Worker(WORKER_PATH);
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        worker.terminate();
        reject(new Error(`Worker build timed out after ${timeout}ms`));
      }
    }, timeout);

    worker.onmessage = (event: MessageEvent<BuildResponse>) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data);
      }
    };

    worker.onerror = (event) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(`Worker build error: ${event.message}`));
      }
    };

    worker.postMessage(request);
  });
}
