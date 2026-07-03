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
| `admin`   | A login + dashboard + CRUD admin panel (Tailwind UI).           |

## Flags

```
Usage: create-mochi [path] [options]

Arguments:
  path                where the project should be created

Options:
  --template <name>   starter template (minimal | demos | admin)
  --name <name>       package.json `name` field (defaults to the directory name)
  --force             overwrite existing directory contents
  -v, --version       show CLI version
  -h, --help          show this help
```

Run with no arguments for an interactive prompt:

```sh
bunx create-mochi
```

## Programmatic API

```ts
import { create } from 'create-mochi';

await create({
  dir: './my-app',
  template: 'minimal',
  name: 'my-app',
});
```

## Requirements

Mochi runs on [Bun](https://bun.sh/). Install it first:

```sh
curl -fsSL https://bun.sh/install | bash
```

## License

MIT
