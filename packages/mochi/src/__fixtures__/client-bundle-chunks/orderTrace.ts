const g = globalThis as unknown as { __mochiChunkTrace?: string[] };
export const trace = (g.__mochiChunkTrace ??= []);
