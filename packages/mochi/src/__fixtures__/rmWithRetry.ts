import { rmSync } from 'node:fs';

/**
 * Best-effort recursive rm for test temp dirs: Windows releases SQLite file locks asynchronously, so an immediate rm
 * can throw EBUSY — retry by hand, since Bun ignores rmSync's maxRetries option. Never fails the suite.
 */
export async function rmWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(100);
    }
  }
}
