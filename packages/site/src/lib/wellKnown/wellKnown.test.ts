import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes as apiCatalogRoutes } from './apiCatalog';
import { routes as mcpCardRoutes } from './mcpCard';
import { routes as agentCardRoutes } from './agentCard';
import { routes as agentSkillsRoutes } from './agentSkills';
import { agentDiscoveryLinks, AGENT_DISCOVERY_LINK } from './agentDiscoveryLinks';
import { routes as demoApiRoutes } from '../../demos/api/routes';

describe('agent-discovery well-known surfaces', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '..', '.mochi-wellknown-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      // Mirror the site's policy so the test guards that these api routes stay
      // exempt from the trailing-slash redirect and answer at their exact paths.
      trailingSlash: 'always',
      handle: agentDiscoveryLinks,
      routes: {
        '/': Mochi.api(() => Response.json({ ok: true })),
        '/other': Mochi.api(() => Response.json({ ok: true })),
        // The real /health route the api-catalog's status link targets. Pick
        // just the one entry so the demo's Svelte page isn't compiled.
        '/health': demoApiRoutes['/health']!,
        ...apiCatalogRoutes,
        ...mcpCardRoutes,
        ...agentCardRoutes,
        ...agentSkillsRoutes,
      },
    });
    base = `http://localhost:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('GET /.well-known/api-catalog returns a linkset without redirecting', async () => {
    const res = await fetch(`${base}/.well-known/api-catalog`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/linkset+json');

    const body = (await res.json()) as { linkset: Array<{ anchor: string; 'service-doc'?: Array<{ href: string }>; status?: Array<{ href: string }> }> };
    expect(Array.isArray(body.linkset)).toBe(true);
    const entry = body.linkset[0]!;
    expect(entry.anchor).toBe(`${base}/mcp`);
    expect(entry['service-doc']?.[0]?.href).toBe(`${base}/llms.txt`);
    // api routes are exempt from trailingSlash, so the status link is the bare path.
    expect(entry.status?.[0]?.href).toBe(`${base}/health`);
  });

  test('the api-catalog status target GET /health responds 200 without redirecting', async () => {
    const res = await fetch(`${base}/health`, { redirect: 'manual' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  test('GET /.well-known/mcp/server-card.json describes the streamable-http endpoint', async () => {
    const res = await fetch(`${base}/.well-known/mcp/server-card.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('json');

    const body = (await res.json()) as { serverInfo: { name: string; version: string }; transport: { type: string; endpoint: string }; capabilities: unknown };
    expect(body.serverInfo.name).toBe('mochi-docs');
    expect(body.serverInfo.version).toBeTruthy();
    expect(body.transport.type).toBe('streamable-http');
    expect(body.transport.endpoint).toBe(`${base}/mcp`);
  });

  test('GET /.well-known/agent-card.json exposes the documentation skills', async () => {
    const res = await fetch(`${base}/.well-known/agent-card.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('json');

    const body = (await res.json()) as { name: string; version: string; skills: Array<{ id: string }>; supportedInterfaces: Array<{ url: string }> };
    expect(body.name).toBeTruthy();
    expect(body.version).toBeTruthy();
    const ids = body.skills.map((s) => s.id);
    expect(ids).toContain('get_documentation_sections');
    expect(ids).toContain('get_section');
    expect(body.supportedInterfaces[0]?.url).toBe(`${base}/mcp`);
  });

  test('GET /.well-known/agent-skills/index.json hashes SKILL.md', async () => {
    const res = await fetch(`${base}/.well-known/agent-skills/index.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('json');

    const body = (await res.json()) as { skills: Array<{ name: string; type: string; url: string; sha256: string; digest: string }> };
    const skill = body.skills[0]!;
    expect(skill.name).toBe('mochi');
    expect(skill.type).toBe('skill-md');
    expect(skill.url).toBe(`${base}/SKILL.md`);
    // Bare hex sha256 plus the prefixed `digest` form, kept in sync.
    expect(skill.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(skill.digest).toBe(`sha256:${skill.sha256}`);
  });

  test('the Link header is appended only on the homepage', async () => {
    const home = await fetch(`${base}/`);
    expect(home.headers.get('Link')).toBe(AGENT_DISCOVERY_LINK);
    // Shape: two RFC 8288 entries pointing at the catalog and the service doc.
    expect(home.headers.get('Link')).toContain('</.well-known/api-catalog>; rel="api-catalog"');
    expect(home.headers.get('Link')).toContain('</llms.txt>; rel="service-doc"');

    const other = await fetch(`${base}/other`);
    expect(other.headers.get('Link')).toBeNull();
  });
});
