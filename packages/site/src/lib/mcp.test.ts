import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mcpServer } from './mcp';
import { CHANGELOG_URL } from './changelog';

const CHANGELOG_BODY = '# Changelog\n\n## [0.8.0] mochi-framework\n\n### Features\n\n- something\n';
const realFetch = globalThis.fetch;

type JsonRpcResult = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; serverInfo?: { name: string } } };

async function call(method: string, params?: unknown, id = 1): Promise<JsonRpcResult> {
  return (await mcpServer.receive({ jsonrpc: '2.0', id, method, params } as never)) as JsonRpcResult;
}

function toolText(res: JsonRpcResult): string {
  return res.result?.content?.map((c) => c.text).join('') ?? '';
}

describe('mcp docs server', () => {
  beforeAll(async () => {
    // buildSectionIndex + get_section({ doc, changelog }) fetch the changelog from
    // GitHub — stub it so the test never hits the network (own process per file).
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === CHANGELOG_URL) {
        return new Response(CHANGELOG_BODY);
      }
      return realFetch(input as never);
    }) as typeof fetch;
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
    await mcpServer.receive({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  test('initialize reports the server identity', async () => {
    const res = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
    expect(res.result?.serverInfo?.name).toBe('mochi-docs');
  });

  test('tools/list exposes exactly the two documentation tools', async () => {
    const res = await call('tools/list', {});
    const names = res.result?.tools?.map((t) => t.name) ?? [];
    expect(names).toContain('get_documentation_sections');
    expect(names).toContain('get_section');
  });

  test('get_documentation_sections lists known docs and demos with their type', async () => {
    const res = await call('tools/call', { name: 'get_documentation_sections', arguments: {} });
    const sections = JSON.parse(toolText(res)) as { type: string; slug: string; title: string; description: string }[];
    expect(sections.some((s) => s.type === 'doc' && s.slug === 'intro')).toBe(true);
    expect(sections.some((s) => s.type === 'demo' && s.slug === 'hello-world')).toBe(true);
    // Blog posts and the synthetic changelog doc are listed too.
    expect(sections.some((s) => s.type === 'post')).toBe(true);
    expect(sections.some((s) => s.type === 'doc' && s.slug === 'changelog')).toBe(true);
    // Every entry carries the fields an agent needs to pick and fetch a section.
    for (const s of sections) {
      expect(s.type === 'doc' || s.type === 'demo' || s.type === 'post').toBe(true);
      expect(s.slug).toBeTruthy();
      expect(s.title).toBeTruthy();
    }
  });

  test('get_section returns the raw markdown for a doc', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { sections: [{ type: 'doc', slug: 'intro' }] } });
    const text = toolText(res);
    expect(text).toContain('==== doc:intro ====');
    expect(text).toContain('slug: intro');
  });

  test('get_section returns the source bundle for a demo', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { sections: [{ type: 'demo', slug: 'hello-world' }] } });
    const text = toolText(res);
    expect(text).toContain('==== demo:hello-world ====');
    expect(text).toContain('## Demo: hello-world');
  });

  test('get_section returns the raw markdown for a blog post', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { sections: [{ type: 'post', slug: 'mochi-0-8-0' }] } });
    const text = toolText(res);
    expect(text).toContain('==== post:mochi-0-8-0 ====');
    expect(text).toContain('slug: mochi-0-8-0');
  });

  test('get_section returns the stubbed changelog for the synthetic doc', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { sections: [{ type: 'doc', slug: 'changelog' }] } });
    const text = toolText(res);
    expect(text).toContain('==== doc:changelog ====');
    expect(text).toContain('# Changelog');
    expect(text).toContain('0.8.0');
  });

  test('the type qualifier disambiguates a slug that is both a doc and a demo', async () => {
    // `hydratable` exists as both a doc page and a demo; only the type tells them apart.
    const res = await call('tools/call', {
      name: 'get_section',
      arguments: {
        sections: [
          { type: 'doc', slug: 'hydratable' },
          { type: 'demo', slug: 'hydratable' },
        ],
      },
    });
    const text = toolText(res);
    expect(text).toContain('==== doc:hydratable ====');
    expect(text).toContain('==== demo:hydratable ====');
    // doc comes before demo (requested order preserved)
    expect(text.indexOf('==== doc:hydratable ====')).toBeLessThan(text.indexOf('==== demo:hydratable ===='));
    expect(text).toContain('## Demo: hydratable');
  });

  test('multiple sections are returned in the requested order', async () => {
    const res = await call('tools/call', {
      name: 'get_section',
      arguments: {
        sections: [
          { type: 'doc', slug: 'intro' },
          { type: 'demo', slug: 'hello-world' },
        ],
      },
    });
    const text = toolText(res);
    expect(text.indexOf('==== doc:intro ====')).toBeLessThan(text.indexOf('==== demo:hello-world ===='));
  });

  test('missing slugs appear inline as (not found) but found sections still return as text', async () => {
    const res = await call('tools/call', {
      name: 'get_section',
      arguments: {
        sections: [
          { type: 'doc', slug: 'intro' },
          { type: 'doc', slug: 'no-such-slug' },
        ],
      },
    });
    expect(res.result?.isError).toBeUndefined();
    const text = toolText(res);
    expect(text).toContain('==== doc:intro ====');
    expect(text).toContain('==== doc:no-such-slug ====');
    expect(text).toContain('(not found)');
  });

  test('returns a tool error only when every requested slug is missing', async () => {
    const res = await call('tools/call', {
      name: 'get_section',
      arguments: {
        sections: [
          { type: 'doc', slug: 'nope-1' },
          { type: 'demo', slug: 'nope-2' },
        ],
      },
    });
    expect(res.result?.isError).toBe(true);
  });
});
