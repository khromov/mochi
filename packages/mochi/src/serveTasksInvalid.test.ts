import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Mochi } from './Mochi';
import { clearTasks } from './tasks/tasks';
import { resetStartupMilestones } from './lifecycle';

// The failed serve() below still claims the `__mochi_config__` singleton before it
// reaches task validation, so no second boot is possible here — hence its own file.
const outDir = mkdtempSync(path.join(import.meta.dir, '..', '.mochi-serve-tasks-invalid-'));

afterAll(() => {
  clearTasks();
  resetStartupMilestones();
  rmSync(outDir, { recursive: true, force: true });
});

test('rejects a tasks value that is not a Mochi.task() descriptor, before binding', async () => {
  await expect(
    Mochi.serve({
      port: 0,
      development: false,
      logger: { enabled: false },
      outDir,
      routes: {},
      // A bare object rather than a Mochi.task() descriptor — the shape a user
      // reaches for first, and silently never running is the worst outcome.
      tasks: { bad: { cron: '* * * * *', run: () => {} } as never },
    }),
  ).rejects.toThrow(/"bad" is not a Mochi\.task\(\.\.\.\) descriptor/);
});
