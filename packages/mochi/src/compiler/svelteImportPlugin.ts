import { plugin } from 'bun';

let registered = false;

export function registerSvelteImportPlugin(): void {
  if (registered) {
    return;
  }
  registered = true;
  plugin({
    name: 'mochi-svelte-source',
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, (args) => ({
        contents: `export default function __MochiStub__() {}\n__MochiStub__.__source = ${JSON.stringify(args.path)};`,
        loader: 'js',
      }));
    },
  });
}

registerSvelteImportPlugin();
