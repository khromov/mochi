import path from 'node:path';
import fs from 'node:fs/promises';
import { downloadTemplate } from './download.ts';
import { getTemplate, type TemplateId } from './templates.ts';
import { addLintTooling, writeLintConfigs } from './lintSetup.ts';
import { ensureGitignore, fetchLatestMochiVersion, resolveMochiVersionRange, setDefaultPort, transformPackageJson, transformTsconfig, validatePackageName } from './utils.ts';

export const SCAFFOLDED_PORT = 3333;

export interface CreateOptions {
  /** Destination directory (absolute or cwd-relative). */
  dir: string;
  template: TemplateId;
  /** Value to write into the generated `package.json` `name` field. */
  name: string;
  /** Overwrite existing files in `dir` if any. Default: `false`. */
  force?: boolean;
  /** Override the version of `mochi-framework` injected into `package.json`. Default: latest from npm. */
  mochiVersion?: string;
  /** Write an ESLint flat config plus lint scripts/devDeps into the scaffold. Default: `true`. */
  eslint?: boolean;
  /** Write a Prettier config plus format scripts/devDeps into the scaffold. Default: `true`. */
  prettier?: boolean;
}

export interface CreateResult {
  /** Absolute path of the scaffolded directory. */
  dir: string;
  template: TemplateId;
  /** Resolved version range that ended up in `package.json`. */
  mochiVersion: string;
}

export async function create(opts: CreateOptions): Promise<CreateResult> {
  const template = getTemplate(opts.template);
  if (!template) {
    throw new Error(`Unknown template: ${opts.template}`);
  }

  const nameError = validatePackageName(opts.name);
  if (nameError) {
    throw new Error(nameError);
  }

  const dir = path.resolve(opts.dir);
  await fs.mkdir(dir, { recursive: true });

  // Template files come from `khromov/mochi`'s default branch, which can be ahead of the published
  // npm version `mochiVersion` resolves to — see `Template.source` to pin a tag instead.
  await downloadTemplate(template.source, {
    dir,
    force: opts.force ?? false,
  });

  const mochiVersion = opts.mochiVersion ?? resolveMochiVersionRange(await fetchLatestMochiVersion());

  await rewriteFile(path.join(dir, 'package.json'), (raw) => transformPackageJson(raw, { name: opts.name, mochiVersion, dir }));
  await rewriteFile(path.join(dir, 'tsconfig.json'), transformTsconfig);
  await rewriteFile(path.join(dir, 'src/index.ts'), (raw) => setDefaultPort(raw, SCAFFOLDED_PORT));

  const lintOpts = { eslint: opts.eslint ?? true, prettier: opts.prettier ?? true };
  await rewriteFile(path.join(dir, 'package.json'), (raw) => addLintTooling(raw, lintOpts));
  writeLintConfigs(dir, lintOpts);

  ensureGitignore(dir);

  return { dir, template: template.id, mochiVersion };
}

async function rewriteFile(file: string, transform: (raw: string) => string): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    return;
  }
  await fs.writeFile(file, transform(raw));
}
