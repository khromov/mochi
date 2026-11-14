// Boots a real Mochi.serve() and exercises `mochi:defer={{ group }}` end-to-end: what the page ships for a grouped
// call site, what the `/island-group/` endpoint answers, and that a member throwing does not take its siblings with it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { parse as devalueParse, stringify as devalueStringify } from 'devalue';
import { Mochi } from '../Mochi';
import { encryptPayload } from './payloadCrypto';
import { groupAad } from './islandGroups';
import { BOOTSTRAP_MARKER_ATTR } from './bootstrapMarker';

const FIXTURES = path.join(import.meta.dir, '..', '__fixtures__', 'island-groups');

interface GroupResponse {
  m: Record<string, string>;
}

describe('grouped server islands', () => {
  let server: Server<undefined>;
  let outDir: string;
  let base: string;
  let html: string;
  let lazyHtml: string;
  let wrappers: string[];
  let coordinator: string;
  let chunks: string[];

  // HTML-entity-decoded, since Bun serves the attributes exactly as `escapeHtmlAttr` wrote them.
  const attr = (tag: string, name: string): string | null => {
    const raw = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
    return raw === undefined
      ? null
      : raw
          .replace(/&quot;/g, `"`)
          .replace(/&lt;/g, `<`)
          .replace(/&gt;/g, `>`)
          .replace(/&amp;/g, `&`);
  };

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '.mochi-island-groups-'));
    server = await Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {
        '/': Mochi.page(path.join(FIXTURES, 'Page.svelte')),
        '/lazy': Mochi.page(path.join(FIXTURES, 'LazyPage.svelte')),
      },
    });
    base = `http://localhost:${server.port}`;

    html = await (await fetch(`${base}/`)).text();
    lazyHtml = await (await fetch(`${base}/lazy`)).text();
    wrappers = [...html.matchAll(/<mochi-server-island\b[^>]*>/g)].map((m) => m[0]!);
    coordinator = html.match(/<mochi-island-group\b[^>]*>/)?.[0] ?? '';
    chunks = (attr(coordinator, 'chunks') ?? '').split(' ').filter(Boolean);
  });

  afterAll(async () => {
    await server?.stop(true);
    rmSync(outDir, { recursive: true, force: true });
  });

  test('grouped call sites ship a group id instead of their own props token', () => {
    const grouped = wrappers.filter((w) => attr(w, 'server-group'));
    expect(grouped).toHaveLength(6);
    for (const wrapper of grouped) {
      expect(attr(wrapper, 'server-group')).toBe(attr(coordinator, 'group-id')!);
      expect(wrapper).not.toContain('signed-props');
      expect(attr(wrapper, 'group-member')).toBeTruthy();
    }
    // Every member has its own wrapper id, which is how the response is split back apart.
    expect(new Set(grouped.map((w) => attr(w, 'group-member'))).size).toBe(6);
  });

  test('one coordinator carries the whole group, with the group-owned options only', () => {
    expect(html.match(/<mochi-island-group\b/g)).toHaveLength(1);
    expect(attr(coordinator, 'group')).toBe('sidebar');
    expect(attr(coordinator, 'server-options')).toBe('{"retries":2}');
    expect(coordinator).not.toContain('defer-on');
    expect(chunks).toHaveLength(1);
  });

  test('the coordinator is emitted after every wrapper it drives', () => {
    expect(html.indexOf('<mochi-island-group')).toBeGreaterThan(html.lastIndexOf('<mochi-server-island'));
  });

  test('a member keeps only `name` in server-options, so it stays reachable by reloadDeferredIsland', () => {
    const named = wrappers.find((w) => w.includes('Counter_'))!;
    expect(attr(named, 'server-options')).toBe('{"name":"counter"}');
  });

  test('an invalid group falls back to an ordinary defer with its own token', () => {
    const ungrouped = wrappers.filter((w) => !attr(w, 'server-group'));
    expect(ungrouped).toHaveLength(1);
    expect(attr(ungrouped[0]!, 'signed-props')).toBeTruthy();
  });

  test('one request returns every member, keyed by wrapper id', async () => {
    const res = await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const { m } = (await res.json()) as GroupResponse;
    const ids = wrappers.filter((w) => attr(w, 'server-group')).map((w) => attr(w, 'group-member')!);
    expect(Object.keys(m).sort()).toEqual([...ids].sort());
  });

  test('members of different components render side by side in the one response', async () => {
    const { m } = (await (await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`)).json()) as GroupResponse;
    const all = Object.values(m).join('');
    expect(all).toContain('alpha:5');
    expect(all).toContain('bravo:5');
    expect(all).toContain('charlie:7');
    expect(all).toContain('<li>item 2</li>');
  });

  test('a throwing member fails alone — its siblings still render', async () => {
    const { m } = (await (await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`)).json()) as GroupResponse;
    const failures = Object.values(m).filter((h) => h.includes('<mochi-island-failure'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('data-component="Boom_');
    // Production hides the reason; only the stub travels.
    expect(failures[0]).not.toContain('data-message');
    expect(Object.values(m).filter((h) => h.includes('class="stars'))).toHaveLength(3);
  });

  test('a mochi:hydrate member comes back hydratable, with its props echoed', async () => {
    const { m } = (await (await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`)).json()) as GroupResponse;
    const counter = Object.values(m).find((h) => h.includes('Counter_'))!;
    expect(counter).toContain('<mochi-hydratable-island');
    expect(counter).toContain('&quot;start&quot;:1');
    // Each member is swapped into its own wrapper, so each carries its own leading bootstrap marker.
    expect(counter).toMatch(new RegExp(`^<template ${BOOTSTRAP_MARKER_ATTR}="[^"]+"></template>`));
    // Nothing else in the group hydrates, so nothing else names a bootstrap.
    expect(Object.values(m).filter((h) => h.includes(BOOTSTRAP_MARKER_ATTR))).toHaveLength(1);
  });

  test('each member is rendered under its own id prefix, so $props.id() never collides', async () => {
    const { m } = (await (await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`)).json()) as GroupResponse;
    const uids = [
      ...Object.values(m)
        .join('')
        .matchAll(/data-uid="([^"]+)"/g),
    ].map((x) => x[1]!);
    expect(uids).toHaveLength(3);
    expect(new Set(uids).size).toBe(3);
  });

  test('nested-island CSS is delivered once across the group', async () => {
    const { m } = (await (await fetch(`${base}/_mochi/island-group/sidebar?g=${chunks[0]}`)).json()) as GroupResponse;
    // The wrapper's own `css-url` carries the island's scoped sheet, so it must not be duplicated into the fragment.
    expect(Object.values(m).join('')).not.toContain('/_mochi/css/Stars-');
  });

  test('a tampered token is rejected', async () => {
    const mangled = `${chunks[0]!.slice(0, -4)}AAAA`;
    expect((await fetch(`${base}/_mochi/island-group/sidebar?g=${mangled}`)).status).toBe(403);
    expect((await fetch(`${base}/_mochi/island-group/sidebar`)).status).toBe(403);
  });

  test('a token sealed for one group cannot be replayed against another', async () => {
    expect((await fetch(`${base}/_mochi/island-group/other?g=${chunks[0]}`)).status).toBe(403);
  });

  test('a well-sealed but malformed payload is rejected rather than half-rendered', async () => {
    const token = encryptPayload(devalueStringify({ n: ['Nope_1'], e: [[7, 's1-0', '{}']] }), { aad: groupAad('sidebar') });
    expect((await fetch(`${base}/_mochi/island-group/sidebar?g=${token}`)).status).toBe(403);
  });

  test('a member naming an unknown island degrades to the failure stub, not a 404 for the group', async () => {
    const payload = devalueStringify({ n: ['Ghost_deadbeef'], e: [[0, 's9-0', devalueStringify({})]] });
    const token = encryptPayload(payload, { aad: groupAad('sidebar') });
    const res = await fetch(`${base}/_mochi/island-group/sidebar?g=${token}`);
    expect(res.status).toBe(200);
    const { m } = (await res.json()) as GroupResponse;
    expect(m['s9-0']).toContain('<mochi-island-failure');
  });

  test('the sealed payload deduplicates component names', async () => {
    const { decryptPayload } = await import('./payloadCrypto');
    const payload = devalueParse(decryptPayload(chunks[0]!, { aad: groupAad('sidebar') })!) as { n: string[] };
    // Three Stars, one Feed, one Boom, one Counter — four distinct components for six members.
    expect(payload.n).toHaveLength(4);
  });

  test('a group whose members are all mochi:defer:visible is lazy; a mixed group is not', () => {
    const coordinators = [...lazyHtml.matchAll(/<mochi-island-group\b[^>]*>/g)].map((m) => m[0]!);
    const lazy = coordinators.find((c) => attr(c, 'group') === 'lazy')!;
    const mixed = coordinators.find((c) => attr(c, 'group') === 'mixed')!;
    expect(attr(lazy, 'defer-on')).toBe('visible');
    expect(attr(lazy, 'server-options')).toBe('{"rootMargin":"200px"}');
    expect(mixed).not.toContain('defer-on');
  });

  test('the single-island endpoint still answers for an ungrouped defer', async () => {
    const ungrouped = wrappers.find((w) => !attr(w, 'server-group'))!;
    const name = attr(ungrouped, 'component-name')!;
    const res = await fetch(`${base}/_mochi/island/${name}?props=${attr(ungrouped, 'signed-props')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ungrouped:9');
  });
});
