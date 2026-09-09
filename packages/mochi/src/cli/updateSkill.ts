import { existsSync } from 'node:fs';
import path from 'node:path';
import { structuredPatch } from 'diff';

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

// Unified diff shown before an existing SKILL.md is overwritten.
export function formatSkillDiff(previous: string, next: string, dest: string, url: string): string {
  const oldName = previous === '' ? '/dev/null' : dest;
  const patch = structuredPatch(oldName, url, previous, next, undefined, undefined, { context: 3 });
  const output = [`--- ${oldName}`, `+++ ${url}`];
  for (const hunk of patch.hunks) {
    output.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, ...hunk.lines);
  }
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
  if (!created && previous === body) {
    return { path: dest, created: false, action: 'unchanged', diff: '' };
  }
  const diff = formatSkillDiff(previous, body, dest, url);
  // A first-time write has no prior content to review, so there is nothing for the operator to approve.
  if (!created && confirmUpdate && !(await confirmUpdate({ path: dest, url, created, diff }))) {
    return { path: dest, created, action: 'aborted', diff };
  }
  await Bun.write(dest, body);

  return { path: dest, created, action: created ? 'created' : 'updated', diff };
}
