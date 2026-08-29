# create-mochi

Scaffold a new [Mochi](https://github.com/khromov/mochi) project.

## Usage

```sh
# bun (recommended)
bun create mochi@latest my-app

# npm — requires bun to be installed locally, since the resulting project runs on bun
npm create mochi@latest my-app
```

Or run the binary directly:

```sh
bunx create-mochi my-app
npx create-mochi my-app
```

## Templates

| Template  | Description                                                     |
| --------- | --------------------------------------------------------------- |
| `minimal` | A bare-bones Mochi app with a single page.                      |
| `demos`   | A larger reference app with multiple demos (HN clone, todo, …). |

## Flags

```
Usage: create-mochi [path] [options]

Arguments:
  path                where the project should be created

Options:
  --template <name>   starter template (minimal | demos)
  --force             overwrite existing directory contents
  --eslint            include ESLint setup (default)
  --no-eslint         skip ESLint setup
  --prettier          include Prettier setup (default)
  --no-prettier       skip Prettier setup
  --vercel            rename the Dockerfile to Vercel's Dockerfile.vercel convention
  --no-vercel         keep the plain Dockerfile (default)
  -v, --version       show CLI version
  -h, --help          show this help
```

The `package.json` `name` field defaults to the target directory's name.

Run with no arguments for an interactive prompt:

```sh
bunx create-mochi
```

## Linting and formatting

Scaffolds include ESLint and Prettier by default (skip either with `--no-eslint` / `--no-prettier`, or answer the interactive prompts):

- **ESLint** adds an `eslint.config.js` flat config (`@eslint/js`, `typescript-eslint`, `eslint-plugin-svelte`) plus `lint` / `lint:fix` scripts.
- **Prettier** adds `.prettierrc` and `.prettierignore` (with `prettier-plugin-svelte`) plus `format` / `format:check` scripts.
- When both are enabled, `eslint-config-prettier` is included so ESLint defers formatting concerns to Prettier.

## Programmatic API

```ts
import { create } from 'create-mochi';

await create({
  dir: './my-app',
  template: 'minimal',
  name: 'my-app',
  eslint: true, // default
  prettier: true, // default
  vercel: false, // default
});
```

## Deploying to Vercel

Answering yes to the **"Are you planning to deploy to Vercel?"** prompt (or passing `--vercel`) renames the scaffolded `Dockerfile` to `Dockerfile.vercel`, strips its baked-in `ENV PORT` so the app honours Vercel's injected `$PORT`, and retargets the matching `.dockerignore` entry. See the [Mochi on Vercel](https://mochi.fast/docs/vercel/) guide.

## Requirements

Mochi runs on [Bun](https://bun.sh/). Install it first:

```sh
curl -fsSL https://bun.sh/install | bash
```

## License

MIT
