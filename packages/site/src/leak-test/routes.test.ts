import { expect, test } from 'bun:test';

// `bun run test:leak` runs the site with NODE_ENV=production and MOCHI_MEMORY_PROBE=1.
test('the leak-harness routes are mounted outside development when MOCHI_MEMORY_PROBE=1', async () => {
  process.env.MOCHI_MEMORY_PROBE = '1';
  const { routes } = await import('../routes');
  expect(process.env.NODE_ENV).not.toBe('development');
  expect(routes['/__leak/server-island']).toBeDefined();
});
