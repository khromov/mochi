declare let self: Worker;

import type { BuildRequest, BuildResponse, SerializedOutput, SsrSideEffects } from '../runBuildInWorker';

self.onmessage = async (event: MessageEvent<BuildRequest>) => {
  const { kind, buildOptions, pluginConfig } = event.data;

  try {
    let plugins: import('bun').BunPlugin[] | undefined;
    let getSideEffects: (() => SsrSideEffects) | undefined;

    if (kind === 'ssr' && pluginConfig) {
      const { createSsrPlugin } = await import('./ssr-plugin-factory');
      const result = createSsrPlugin(pluginConfig as import('../runBuildInWorker').SsrPluginConfig);
      plugins = [result.plugin];
      getSideEffects = result.getSideEffects;
    } else if (kind === 'client' && pluginConfig) {
      const { createClientPlugin } = await import('./client-plugin-factory');
      const result = createClientPlugin(pluginConfig as import('../runBuildInWorker').ClientPluginConfig);
      plugins = [result.plugin];
    }

    const result = await Bun.build({
      ...buildOptions,
      plugins,
      throw: false,
    });

    const outputs: SerializedOutput[] = [];
    for (const output of result.outputs) {
      outputs.push({
        path: output.path,
        text: await output.text(),
        kind: output.kind,
      });
    }

    const logs = result.logs.map((l) => ({
      message: l.message,
      position: (l as { position?: { file: string; line: number; column: number } | null }).position ?? null,
    }));

    const response: BuildResponse = {
      success: result.success,
      logs,
      outputs,
      metafile: result.metafile as Record<string, unknown> | undefined,
      sideEffects: getSideEffects?.(),
    };

    postMessage(response);
  } catch (err) {
    const response: BuildResponse = {
      success: false,
      logs: [{ message: err instanceof Error ? err.message : String(err) }],
      outputs: [],
    };
    postMessage(response);
  }
};
