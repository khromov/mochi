import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SKILL_URL = 'https://mochi.fast/SKILL.md';

// Where each agent looks for skills. antigravity and codex share the same
// `.agents/` convention, so they resolve to the same destination.
export const SKILL_DESTS = {
  'claude-code': path.join('.claude', 'skills', 'mochi', 'SKILL.md'),
  opencode: path.join('.opencode', 'skills', 'mochi', 'SKILL.md'),
  antigravity: path.join('.agents', 'skills', 'mochi', 'SKILL.md'),
  codex: path.join('.agents', 'skills', 'mochi', 'SKILL.md'),
} as const;

export type SkillTarget = keyof typeof SKILL_DESTS;

export const SKILL_TARGETS = Object.keys(SKILL_DESTS) as SkillTarget[];

export const DEFAULT_SKILL_TARGET: SkillTarget = 'claude-code';

type FetchLike = (url: string) => Promise<Response>;

export interface UpdateSkillOptions {
  cwd?: string;
  url?: string;
  target?: SkillTarget;
  fetchImpl?: FetchLike;
  confirmUpdate?: (preview: UpdateSkillPreview) => boolean | Promise<boolean>;
}

export interface UpdateSkillPreview {
  path: string;
  url: string;
  created: boolean;
  diff: string;
}

export interface UpdateSkillResult {
  path: string;
  created: boolean;
  action: 'created' | 'updated' | 'unchanged' | 'aborted';
  diff: string;
}

function lines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const result = text.split('\n');
  if (result.at(-1) === '') {
    result.pop();
  }
  return result;
}

export function formatSkillDiff(previous: string, next: string, dest: string, url: string): string {
  const before = lines(previous);
  const after = lines(next);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) {
    suffix++;
  }

  const contextStart = Math.max(0, prefix - 3);
  const beforeEnd = before.length - suffix;
  const afterEnd = after.length - suffix;
  const contextEndBefore = Math.min(before.length, beforeEnd + 3);
  const contextEndAfter = Math.min(after.length, afterEnd + 3);
  const oldStart = contextStart + 1;
  const oldCount = contextEndBefore - contextStart;
  const newCount = contextEndAfter - contextStart;
  const output = [`--- ${previous === '' ? '/dev/null' : dest}`, `+++ ${url}`, `@@ -${oldStart},${oldCount} +${oldStart},${newCount} @@`];
  output.push(...before.slice(contextStart, prefix).map((line) => ` ${line}`));
  output.push(...before.slice(prefix, beforeEnd).map((line) => `-${line}`));
  output.push(...after.slice(prefix, afterEnd).map((line) => `+${line}`));
  output.push(...after.slice(afterEnd, contextEndAfter).map((line) => ` ${line}`));
  return `${output.join('\n')}\n`;
}

// Pulls the hosted Mochi SKILL.md into the consuming project so the agent
// guidance stays in sync with the framework version, rather than drifting from
// a copy scaffolded once at project creation.
export async function updateSkill(options: UpdateSkillOptions = {}): Promise<UpdateSkillResult> {
  // MOCHI_SKILL_URL overrides the source — primarily so the CLI can be exercised
  // end-to-end against a local server without hitting the network.
  const { cwd = process.cwd(), url = process.env.MOCHI_SKILL_URL || DEFAULT_SKILL_URL, target = DEFAULT_SKILL_TARGET, fetchImpl = fetch, confirmUpdate } = options;

  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${url}: ${msg}`, { cause: err });
  }

  if (!res.ok) {
    throw new Error(`Could not fetch SKILL.md from ${url} (HTTP ${res.status}). The hosted skill may not be published yet.`);
  }

  const body = await res.text();
  const dest = path.resolve(cwd, SKILL_DESTS[target]);
  const created = !existsSync(dest);
  const previous = created ? '' : await Bun.file(dest).text();
  if (previous === body) {
    return { path: dest, created: false, action: 'unchanged', diff: '' };
  }
  const diff = formatSkillDiff(previous, body, dest, url);
  if (confirmUpdate && !(await confirmUpdate({ path: dest, url, created, diff }))) {
    return { path: dest, created, action: 'aborted', diff };
  }
  await Bun.write(dest, body);

  return { path: dest, created, action: created ? 'created' : 'updated', diff };
}
