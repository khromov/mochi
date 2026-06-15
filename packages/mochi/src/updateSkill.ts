import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SKILL_URL = 'https://mochi.fast/SKILL.md';
const SKILL_DEST = path.join('.claude', 'skills', 'mochi', 'SKILL.md');

type FetchLike = (url: string) => Promise<Response>;

export interface UpdateSkillOptions {
  cwd?: string;
  url?: string;
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
  const { cwd = process.cwd(), url = DEFAULT_SKILL_URL, fetchImpl = fetch } = options;

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
  const dest = path.resolve(cwd, SKILL_DEST);
  const created = !existsSync(dest);
  await Bun.write(dest, body);

  return { path: dest, created };
}
