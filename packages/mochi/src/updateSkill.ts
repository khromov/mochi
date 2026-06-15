import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SKILL_URL = 'https://mochi.fast/SKILL.md';

// Where each agent looks for skills. antigravity and codex share the same
// `.agents/` convention, so they resolve to the same destination.
const SKILL_DESTS = {
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
}

export interface UpdateSkillResult {
  path: string;
  created: boolean;
}

// Pulls the hosted Mochi SKILL.md into the consuming project so the agent
// guidance stays in sync with the framework version, rather than drifting from
// a copy scaffolded once at project creation.
export async function updateSkill(options: UpdateSkillOptions = {}): Promise<UpdateSkillResult> {
  // MOCHI_SKILL_URL overrides the source — primarily so the CLI can be exercised
  // end-to-end against a local server without hitting the network.
  const { cwd = process.cwd(), url = process.env.MOCHI_SKILL_URL || DEFAULT_SKILL_URL, target = DEFAULT_SKILL_TARGET, fetchImpl = fetch } = options;

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
  await Bun.write(dest, body);

  return { path: dest, created };
}
