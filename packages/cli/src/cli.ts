#!/usr/bin/env bun
import path from 'node:path';
import { Command, Option } from 'commander';
import * as p from '@clack/prompts';
import { styleText } from 'node:util';
import pkg from '../package.json' with { type: 'json' };
import { create, SCAFFOLDED_PORT } from './create.ts';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from './templates.ts';
import { bunVersionWarning, isDirEmpty, validatePackageName } from './utils.ts';

const program = new Command('create-mochi')
  .description('Scaffold a new Mochi project.')
  .argument('[path]', 'where the project should be created')
  .addOption(new Option('--template <name>', 'starter template').choices([...TEMPLATE_IDS]))
  .addOption(new Option('--force', 'overwrite existing directory contents'))
  .addOption(new Option('--eslint', 'include ESLint setup (default)'))
  .addOption(new Option('--no-eslint', 'skip ESLint setup'))
  .addOption(new Option('--prettier', 'include Prettier setup (default)'))
  .addOption(new Option('--no-prettier', 'skip Prettier setup'))
  .addOption(new Option('--vercel', "rename the Dockerfile to Vercel's Dockerfile.vercel convention"))
  .addOption(new Option('--no-vercel', 'keep the plain Dockerfile (default)'))
  .version(pkg.version, '-v, --version')
  .configureHelp({
    formatHelp(cmd, helper) {
      const sections = [helper.commandUsage(cmd), '', cmd.description(), '', 'Templates:'];
      for (const t of TEMPLATES) {
        sections.push(`  ${t.id.padEnd(10)} ${t.hint}`);
      }
      sections.push('', 'Options:');
      for (const opt of helper.visibleOptions(cmd)) {
        sections.push(`  ${helper.optionTerm(opt).padEnd(28)} ${helper.optionDescription(opt)}`);
      }
      return sections.join('\n') + '\n';
    },
  })
  .action(runCreate);

await program.parseAsync().catch((err) => {
  p.cancel(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

interface CliOptions {
  template?: TemplateId;
  force?: boolean;
  eslint?: boolean;
  prettier?: boolean;
  vercel?: boolean;
}

async function runCreate(rawPath: string | undefined, opts: CliOptions): Promise<void> {
  p.intro(`${styleText(['bgMagenta', 'black'], ' create-mochi ')} ${styleText('dim', `v${pkg.version}`)}`);

  const bunWarning = bunVersionWarning(Bun.version);
  if (bunWarning) {
    p.log.warn(styleText('yellow', bunWarning));
  }

  const dir = await promptDirectory(rawPath);
  const force = await maybePromptForce(dir, opts.force === true);
  const template = await promptTemplate(opts.template);
  const eslint = await promptToggle(opts.eslint, 'Add ESLint for linting?');
  const prettier = await promptToggle(opts.prettier, 'Add Prettier for formatting?');
  const vercel = await promptToggle(opts.vercel, 'Are you planning to deploy to Vercel?', false);
  const name = defaultNameFor(dir);

  const spinner = p.spinner();
  spinner.start(`Downloading ${styleText('cyan', template)} template`);
  let result;
  try {
    result = await create({ dir, template, name, force, eslint, prettier, vercel });
  } catch (err) {
    spinner.stop(styleText('red', 'Failed to download template.'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  spinner.stop(`Downloaded ${styleText('cyan', template)} template`);

  const rel = path.relative(process.cwd(), result.dir) || '.';
  p.note(
    [
      styleText('dim', 'Run this to get started:'),
      '',
      `${styleText('dim', '1.')} cd ${rel}`,
      `${styleText('dim', '2.')} bun install`,
      `${styleText('dim', '3.')} bun run dev`,
      ...(vercel ? ['', styleText('dim', 'Deploy:'), `   vercel deploy  ${styleText('dim', '# builds Dockerfile.vercel — see https://mochi.fast/docs/vercel/')}`] : []),
      '',
      styleText('dim', `mochi-framework pinned to ${result.mochiVersion}`),
    ].join('\n'),
    "You're all set!",
  );
  p.outro(
    [
      styleText('italic', 'Server renders calm'),
      `   ${styleText('italic', "Islands wake to user's touch")}`,
      `   ${styleText('italic', 'Mochi blooms in code')}`,
      '',
      `   ${styleText('dim', 'Docs:')}  ${styleText('cyan', 'https://mochi.fast/')}`,
      `   ${styleText('dim', 'Local:')} ${styleText('cyan', `http://localhost:${SCAFFOLDED_PORT}/`)}`,
    ].join('\n'),
  );
}

function defaultNameFor(dir: string): string {
  const base = path.basename(path.resolve(dir));
  return validatePackageName(base) === null ? base : 'mochi-app';
}

async function promptDirectory(provided: string | undefined): Promise<string> {
  if (provided) {
    return provided;
  }
  const result = await p.text({
    message: 'Where should the project be created?',
    placeholder: './my-mochi-app',
    defaultValue: './my-mochi-app',
    validate: (value) => {
      if (value && value.trim() === '') {
        return 'Path cannot be empty.';
      }
      return undefined;
    },
  });
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return result;
}

async function maybePromptForce(dir: string, alreadyForced: boolean): Promise<boolean> {
  const abs = path.resolve(dir);
  if (isDirEmpty(abs)) {
    return false;
  }
  if (alreadyForced) {
    return true;
  }
  const confirm = await p.confirm({
    message: `${styleText('cyan', dir)} is not empty. Continue and overwrite conflicting files?`,
    initialValue: false,
  });
  if (p.isCancel(confirm) || confirm !== true) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return true;
}

async function promptToggle(provided: boolean | undefined, message: string, initialValue = true): Promise<boolean> {
  if (provided !== undefined) {
    return provided;
  }
  // No terminal to ask (CI, piped stdin) — take the default rather than hanging on the prompt.
  if (!process.stdin.isTTY) {
    return initialValue;
  }
  const result = await p.confirm({ message, initialValue });
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return result;
}

async function promptTemplate(provided: string | undefined): Promise<TemplateId> {
  if (provided && (TEMPLATE_IDS as readonly string[]).includes(provided)) {
    return provided as TemplateId;
  }
  const result = await p.select<TemplateId>({
    message: 'Which template would you like?',
    options: TEMPLATES.map((t) => ({ label: t.label, value: t.id, hint: t.hint })),
    initialValue: 'minimal',
  });
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return result;
}
