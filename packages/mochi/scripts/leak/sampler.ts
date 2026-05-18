import { spawnSync } from 'node:child_process';

export type RssSample = { t: number; rssKb: number; vszKb: number };

export type MemoryProbe = {
  t: number;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

export function sampleRss(pid: number): RssSample | null {
  const out = spawnSync('ps', ['-o', 'rss=,vsz=', '-p', String(pid)], { encoding: 'utf8' });
  if (out.status !== 0) {
    return null;
  }
  const line = out.stdout.trim();
  if (!line) {
    return null;
  }
  const parts = line.split(/\s+/).map((n) => Number.parseInt(n, 10));
  const rss = parts[0];
  const vsz = parts[1];
  if (rss === undefined || !Number.isFinite(rss)) {
    return null;
  }
  return { t: Date.now(), rssKb: rss, vszKb: vsz !== undefined && Number.isFinite(vsz) ? vsz : 0 };
}

export function startRssPoller(pid: number, intervalMs: number, onSample: (s: RssSample) => void): () => void {
  const id = setInterval(() => {
    const s = sampleRss(pid);
    if (s) {
      onSample(s);
    }
  }, intervalMs);
  return () => clearInterval(id);
}

export async function probeMemory(baseUrl: string): Promise<MemoryProbe | null> {
  try {
    const res = await fetch(`${baseUrl}/__mochi/health/memory`, { keepalive: true });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      timestamp: number;
      memory: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
        external: number;
        arrayBuffers: number;
      };
    };
    return { t: body.timestamp, ...body.memory };
  } catch {
    return null;
  }
}

export async function steadyStateProbe(baseUrl: string): Promise<MemoryProbe | null> {
  // First call triggers Bun.gc(true); read the third for steady state.
  await probeMemory(baseUrl);
  await Bun.sleep(200);
  await probeMemory(baseUrl);
  await Bun.sleep(200);
  return probeMemory(baseUrl);
}
