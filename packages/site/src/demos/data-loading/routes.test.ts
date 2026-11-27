import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Server } from 'bun';
import { Mochi } from 'mochi-framework';
import { routes } from './routes';

const POKEAPI = 'https://pokeapi.co/api/v2/pokemon';
const KNOWN = ['bulbasaur', 'pikachu'];

let server: Server<undefined> | undefined;
let outDir: string;
let base: string;
const upstream: string[] = [];
const realFetch = globalThis.fetch;

function pokemonJson(name: string) {
  return {
    id: KNOWN.indexOf(name) + 1,
    name,
    height: 4,
    weight: 60,
    base_experience: 112,
    sprites: { front_default: '' },
    types: [{ type: { name: 'electric' } }],
    abilities: [{ ability: { name: 'static' } }],
    stats: [{ stat: { name: 'hp' }, base_stat: 35 }],
  };
}

function storedPokemonKeys(): string[] {
  const registry = (globalThis as unknown as { __mochi_pressure_registry__?: { responders: Set<WeakRef<{ keys?(): string[] }>> } }).__mochi_pressure_registry__;
  return [...(registry?.responders ?? [])].flatMap((ref) => ref.deref()?.keys?.() ?? []).filter((key) => key.startsWith('pokemon:') && key !== 'pokemon:list:151');
}

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (!url.startsWith(POKEAPI)) {
      return realFetch(input as never, init as never);
    }
    upstream.push(url);
    if (url === `${POKEAPI}?limit=151`) {
      return Response.json({ results: KNOWN.map((name) => ({ name })) });
    }
    const name = decodeURIComponent(url.slice(POKEAPI.length + 1));
    return KNOWN.includes(name) ? Response.json(pokemonJson(name)) : new Response('Not Found', { status: 404 });
  }) as typeof fetch;
  outDir = mkdtempSync(path.join(import.meta.dir, '..', '..', '..', '.mochi-data-loading-'));
  server = await Mochi.serve({ port: 0, development: false, logger: { enabled: false }, outDir, routes });
  base = `http://localhost:${server.port}`;
}, 120_000);

afterAll(() => {
  globalThis.fetch = realFetch;
  server?.stop(true);
  rmSync(outDir, { recursive: true, force: true });
});

test('renders a Pokémon from the list', async () => {
  const res = await fetch(`${base}/demos/data-loading/pikachu`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('pikachu');
  expect(upstream).toContain(`${POKEAPI}/pikachu`);
  expect(storedPokemonKeys()).toContain('pokemon:pikachu');
});

test('ids outside the list never reach the cache or pokeapi.co', async () => {
  upstream.length = 0;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${base}/demos/data-loading/${'x'.repeat(2000)}-${i}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('No Pokémon found');
  }
  expect(upstream.filter((url) => url !== `${POKEAPI}?limit=151`)).toEqual([]);
  expect(storedPokemonKeys().every((key) => KNOWN.includes(key.slice('pokemon:'.length)))).toBe(true);
});
