import path from 'node:path';
import { Mochi, getRequestContext } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';
import { SITE_ROOT } from '../siteRoot';

const SKILL_PATH = path.join(SITE_ROOT, 'src', 'SKILL.md');
const SCHEMA_URL = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

// SKILL.md is static at runtime, so hash it once on first request rather than
// per-request — but lazily, to keep the cost off the module-load path.
let skillHash: string | undefined;

async function getSkillHash(): Promise<string> {
  if (skillHash === undefined) {
    const bytes = await Bun.file(SKILL_PATH).arrayBuffer();
    skillHash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  }
  return skillHash;
}

export const routes: Record<string, MochiRouteValue> = {
  '/.well-known/agent-skills/index.json': Mochi.api(async () => {
    const { url } = getRequestContext();
    const hex = await getSkillHash();

    return Response.json({
      $schema: SCHEMA_URL,
      skills: [
        {
          name: 'mochi',
          type: 'skill-md',
          description:
            'Use whenever the user asks to build, add, or modify anything in this Mochi app — pages, routes, islands, selective/lazy/server hydration, forms, JSON/WS/SSE endpoints, cookies, caching, or request context. Before writing any framework code, invoke the "mochi" skill to fetch the relevant Mochi docs and demos.',
          url: `${url.origin}/SKILL.md`,
          // RFC v0.2.0 names the field `digest` (prefixed); `sha256` is the bare
          // hex the discovery checkers look for. Emit both for compatibility.
          digest: `sha256:${hex}`,
          sha256: hex,
        },
      ],
    });
  }),
};
