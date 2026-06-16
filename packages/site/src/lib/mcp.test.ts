import { beforeAll, describe, expect, test } from 'bun:test';
import { mcpServer } from './mcp';

// Drive the MCP server through receive() directly — no HTTP transport needed — to prove the two tools
// list, return the right content, and disambiguate the slugs that exist as both a doc and a demo.
type JsonRpcResult = { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[]; serverInfo?: { name: string } } };

async function call(method: string, params?: unknown, id = 1): Promise<JsonRpcResult> {
  return (await mcpServer.receive({ jsonrpc: '2.0', id, method, params } as never)) as JsonRpcResult;
}

function toolText(res: JsonRpcResult): string {
  return res.result?.content?.map((c) => c.text).join('') ?? '';
}

describe('mcp docs server', () => {
  beforeAll(async () => {
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } });
    await mcpServer.receive({ jsonrpc: '2.0', method: 'notifications/initialized' } as never);
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
    // Every entry carries the fields an agent needs to pick and fetch a section.
    for (const s of sections) {
      expect(s.type === 'doc' || s.type === 'demo').toBe(true);
      expect(s.slug).toBeTruthy();
      expect(s.title).toBeTruthy();
    }
  });

  test('get_section returns the raw markdown for a doc', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { type: 'doc', slug: 'intro' } });
    expect(toolText(res)).toContain('slug: intro');
  });

  test('get_section returns the source bundle for a demo', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { type: 'demo', slug: 'hello-world' } });
    expect(toolText(res)).toContain('## Demo: hello-world');
  });

  test('the type qualifier disambiguates a slug that is both a doc and a demo', async () => {
    // `hydratable` exists as both a doc page and a demo; only the type tells them apart.
    const doc = await call('tools/call', { name: 'get_section', arguments: { type: 'doc', slug: 'hydratable' } });
    const demo = await call('tools/call', { name: 'get_section', arguments: { type: 'demo', slug: 'hydratable' } });
    const docText = toolText(doc);
    const demoText = toolText(demo);
    expect(docText).not.toBe(demoText);
    expect(demoText).toContain('## Demo: hydratable');
    expect(docText).not.toContain('## Demo: hydratable');
  });

  test('an unknown slug returns a tool error, not a crash', async () => {
    const res = await call('tools/call', { name: 'get_section', arguments: { type: 'doc', slug: 'does-not-exist' } });
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toContain('does-not-exist');
  });
});
