import path from 'node:path';

const which = process.argv[2] === 'small' ? 'small' : 'big';

const plugin: import('bun').BunPlugin = {
  name: 'declines-every-font',
  setup(build) {
    build.onLoad({ filter: /\.woff2$/ }, () => undefined);
  },
};

const result = await Bun.build({
  entrypoints: [path.join(import.meta.dir, `${which}.css`)],
  outdir: path.join(import.meta.dir, '.out'),
  plugins: [plugin],
  throw: false,
});

console.log(which, 'success:', result.success, '| outputs:', result.outputs.map((o) => path.basename(o.path)).join(', '));
