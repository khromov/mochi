import { compileTailwind } from 'mochi-framework/tailwind';

// TODO: Figure out a better way to do this.
await compileTailwind({
  input: './src/todo/app.css',
  output: './src/todo/app.generated.css',
  minify: true,
});
