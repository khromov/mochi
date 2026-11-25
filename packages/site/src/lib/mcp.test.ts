import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { tool } from 'tmcp/utils';
import { mcpServer, respondMcp } from './mcp';
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

describe('mcp resource bounds', () => {
  async function post(body: unknown, sessionId: string): Promise<JsonRpcResult> {
    const res = await respondMcp(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
        body: JSON.stringify(body),
      }),
    );
    const sse = await res.text();
    return JSON.parse(sse.slice(sse.indexOf('data: ') + 'data: '.length)) as JsonRpcResult;
  }

  function getSection(sections: unknown[]): Promise<JsonRpcResult> {
    return call('tools/call', { name: 'get_section', arguments: { sections } });
  }

  test('the HTTP transport keeps no initialize payload under a client-chosen session id', async () => {
    mcpServer.tool({ name: 'session_probe', description: 'test-only' }, async () => tool.text(mcpServer.ctx.sessionInfo?.clientInfo?.name ?? 'none'));
    await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'retained', version: '1' } } },
      'attacker-chosen',
    );
    const res = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'session_probe', arguments: {} } }, 'attacker-chosen');
    expect(toolText(res)).toBe('none');
  });

  test('get_section accepts up to 50 sections and rejects more', async () => {
    const intro = { type: 'doc', slug: 'intro' };
    expect((await getSection(Array.from({ length: 50 }, () => intro))).result?.isError).toBeUndefined();
    const res = await getSection(Array.from({ length: 51 }, () => intro));
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toContain('Invalid length');
  });

  test('get_section rejects an oversized slug', async () => {
    const res = await getSection([
      { type: 'doc', slug: 'intro' },
      { type: 'doc', slug: 'a'.repeat(101) },
    ]);
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toContain('Invalid length');
  });

  test('a long array of invalid entries gets an error response proportional to the request', async () => {
    const sections = Array.from({ length: 500 }, () => ({ type: 'nope', slug: 'x' }));
    const res = await getSection(sections);
    expect(res.result?.isError).toBe(true);
    expect(toolText(res).length).toBeLessThan(10 * JSON.stringify(sections).length);
  });

  test('an unknown demo slug is not memoized', async () => {
    await getSection([{ type: 'demo', slug: 'no-such-demo-cache-probe' }]);
    const cache = (globalThis as unknown as { __mochi_site_docs_cache__: { demoLlmsTxt: Map<string, unknown> } }).__mochi_site_docs_cache__;
    expect(cache.demoLlmsTxt.has('no-such-demo-cache-probe')).toBe(false);
  });

  test('a missing slug cannot write a raw newline or escape code into the log', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await getSection([{ type: 'doc', slug: 'x\n\u001b[2m[mochi]\u001b[0m forged line' }]);
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toContain('get_section not found');
      expect(logged).not.toContain('\n');
      expect(logged).not.toContain('\u001b[2m');
    } finally {
      warn.mockRestore();
    }
  });

  test('a missing slug cannot write an 8-bit escape code or Unicode line break into the log', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await getSection([{ type: 'doc', slug: 'x\u009b2m\u0085\u2028\u2029\u007fforged line' }]);
      const logged = warn.mock.calls.flat().join(' ');
      expect(logged).toContain('get_section not found');
      expect(logged).toContain('\\u009b2m\\u0085\\u2028\\u2029\\u007fforged line');
      expect(logged).not.toMatch(/[\u007f-\u009f\u2028\u2029]/);
    } finally {
      warn.mockRestore();
    }
  });
});
