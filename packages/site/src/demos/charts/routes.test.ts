import { describe, expect, spyOn, test } from 'bun:test';
import type { MochiApiConfig, MochiApiEvent } from 'mochi-framework';
import * as serverChart from './serverChart';
import { routes } from './routes';

const handler = (routes['/demos/charts/traffic.png'] as MochiApiConfig).handler;

async function get(query: string): Promise<Uint8Array> {
  const url = new URL(`http://localhost/demos/charts/traffic.png${query}`);
  const res = await handler({ request: new Request(url), url, params: {} } as unknown as MochiApiEvent);
  expect(res.status).toBe(200);
  return new Uint8Array(await res.arrayBuffer());
}

function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe('/demos/charts/traffic.png', () => {
  test('ignores caller-chosen dimensions', async () => {
    expect(pngSize(await get('?width=2000&height=2000'))).toEqual({ width: 640, height: 240 });
  });

  test('renders once and serves the same bytes to every later request', async () => {
    const spy = spyOn(serverChart, 'renderTrafficChart');
    const first = await get('?format=jpeg');
    for (const query of ['?format=jpeg&h=1', '?format=jpeg&width=1999&height=1999', '?format=jpeg&width=64']) {
      expect(await get(query)).toEqual(first);
    }
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
