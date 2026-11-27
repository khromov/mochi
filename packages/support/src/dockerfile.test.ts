import { describe, expect, test } from 'bun:test';
import path from 'node:path';

const repoRoot = path.join(import.meta.dir, '..', '..', '..');

const installStages = async (file: string): Promise<string[]> => {
  const source = (await Bun.file(path.join(repoRoot, file)).text()).replace(/^\s*#.*\r?\n/gm, '').replace(/\\\r?\n/g, ' ');
  return source.split(/^FROM\s/m).filter((stage) => /\bbun install\b/.test(stage));
};

describe.each(['Dockerfile', 'Dockerfile.memtest', 'Dockerfile.production'])('%s', (file) => {
  test('installs dependencies from the committed bun.lock', async () => {
    const stages = await installStages(file);
    expect(stages.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect(stage).toMatch(/^COPY\s[^\n]*\bbun\.lock\b/m);
      for (const install of stage.match(/\bbun install\b[^\n]*/g) ?? []) {
        expect(install).toContain('--frozen-lockfile');
      }
    }
  });
});
