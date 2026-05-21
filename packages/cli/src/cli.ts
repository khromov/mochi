#!/usr/bin/env bun
import path from 'node:path';
import { Command, Option } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import pkg from '../package.json' with { type: 'json' };
import { create } from './create.ts';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from './templates.ts';
import { isDirEmpty, validatePackageName } from './utils.ts';

const program = new Command('create-mochi')
  .description('Scaffold a new Mochi project.')
  .argument('[path]', 'where the project should be created')
  .addOption(new Option('--template <name>', 'starter template').choices([...TEMPLATE_IDS]))
  .addOption(new Option('--name <name>', 'package.json `name` field (defaults to the directory name)'))
  .addOption(new Option('--force', 'overwrite existing directory contents'))
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
  name?: string;
  force?: boolean;
}

async function runCreate(rawPath: string | undefined, opts: CliOptions): Promise<void> {
  p.intro(`${pc.bgMagenta(pc.black(' create-mochi '))} ${pc.dim(`v${pkg.version}`)}`);

  const dir = await promptDirectory(rawPath);
  const force = await maybePromptForce(dir, opts.force === true);
  const template = await promptTemplate(opts.template);
  const name = await promptName(opts.name, defaultNameFor(dir));

  const spinner = p.spinner();
  spinner.start(`Downloading ${pc.cyan(template)} template`);
  let result;
  try {
    result = await create({ dir, template, name, force });
  } catch (err) {
    spinner.stop(pc.red('Failed to download template.'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  spinner.stop(`Downloaded ${pc.cyan(template)} template`);

  const rel = path.relative(process.cwd(), result.dir) || '.';
  p.note(
    [`${pc.dim('1.')} cd ${rel}`, `${pc.dim('2.')} bun install`, `${pc.dim('3.')} bun run dev`, '', pc.dim(`mochi-framework pinned to ${result.mochiVersion}`)].join('\n'),
    "You're all set!",
  );
  p.outro(
    [
      pc.italic('Server renders calm'),
      pc.italic("Islands wake to user's touch"),
      pc.italic('Mochi blooms in code'),
      '',
      `${pc.dim('Docs:')} ${pc.cyan('https://mochi.fast/')}`,
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
    message: `${pc.cyan(dir)} is not empty. Continue and overwrite conflicting files?`,
    initialValue: false,
  });
  if (p.isCancel(confirm) || confirm !== true) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return true;
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

async function promptName(provided: string | undefined, suggested: string): Promise<string> {
  if (provided) {
    const err = validatePackageName(provided);
    if (err) {
      p.cancel(err);
      process.exit(1);
    }
    return provided;
  }
  const result = await p.text({
    message: 'What should the package be named?',
    placeholder: suggested,
    defaultValue: suggested,
    validate: (value) => validatePackageName(value || suggested) ?? undefined,
  });
  if (p.isCancel(result)) {
    p.cancel('Operation cancelled.');
    process.exit(0);
  }
  return result.trim() || suggested;
}
