import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

// MOCHI_KEY is a base64url-encoded 32-byte secret — the same shape
// mochiConfig.ts decodes via `Buffer.from(envKey, 'base64url')`.
const KEY_LINE = /^MOCHI_KEY=.*$/m;

export interface GenerateKeyOptions {
  cwd?: string;
  key?: string;
  force?: boolean;
  // Called when a MOCHI_KEY already exists and `force` is not set. Returning
  // false aborts without touching the file; kept injectable so tests don't need
  // an interactive TTY.
  confirmOverwrite?: () => boolean | Promise<boolean>;
}

export interface GenerateKeyResult {
  path: string;
  key: string;
  action: 'created' | 'appended' | 'replaced' | 'aborted';
}

export async function generateKey(options: GenerateKeyOptions = {}): Promise<GenerateKeyResult> {
  const { cwd = process.cwd(), key = randomBytes(32).toString('base64url'), force = false, confirmOverwrite } = options;

  const envPath = path.resolve(cwd, '.env');
  const line = `MOCHI_KEY=${key}`;

  if (!existsSync(envPath)) {
    await Bun.write(envPath, `${line}\n`);
    return { path: envPath, key, action: 'created' };
  }

  const content = await Bun.file(envPath).text();

  if (!KEY_LINE.test(content)) {
    const sep = content.length === 0 || content.endsWith('\n') ? '' : '\n';
    await Bun.write(envPath, `${content}${sep}${line}\n`);
    return { path: envPath, key, action: 'appended' };
  }

  if (!force) {
    const ok = (await confirmOverwrite?.()) ?? false;
    if (!ok) {
      return { path: envPath, key, action: 'aborted' };
    }
  }

  // Function replacer so a `$` in the generated key isn't read as a backreference.
  await Bun.write(
    envPath,
    content.replace(KEY_LINE, () => line),
  );
  return { path: envPath, key, action: 'replaced' };
}
