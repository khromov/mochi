import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toPosixPath } from '../utils';

/** A directive comment that runs a migration OUTSIDE a transaction (e.g. CREATE INDEX CONCURRENTLY). */
const NO_TRANSACTION_DIRECTIVE = /--\s*migrate:no-transaction(?![\w-])/i;

/** `<id><optional _ or - separator><name>.sql` (extension is case-insensitive). */
const FILE_NAME_PATTERN = /^(\d+)[-_]?(.*)\.sql$/i;

export interface MochiMigrationFile {
  id: number;
  name: string;
  filename: string;
  /** Absolute path to the file. */
  path: string;
  /** File contents with line endings normalized to LF. */
  contents: string;
  /** sha256 hex of the normalized contents. */
  hash: string;
  noTransaction: boolean;
}

/**
 * True when `sql` contains anything beyond whitespace, semicolons, `--` line comments, and `/* … *\/` block comments.
 * Bun's SQLite driver throws on comment-only or empty queries, whereas Postgres accepts them.
 */
export function hasExecutableSql(sql: string): boolean {
  let i = sql.charCodeAt(0) === 0xfeff ? 1 : 0;
  let blockDepth = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (blockDepth > 0) {
      if (ch === '/' && next === '*') {
        blockDepth++;
        i += 2;
      } else if (ch === '*' && next === '/') {
        blockDepth--;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (ch === '-' && next === '-') {
      const nl = sql.indexOf('\n', i + 2);
      if (nl === -1) {
        break;
      }
      i = nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (ch === ';' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      i++;
      continue;
    }
    return true;
  }
  // An unclosed block comment is a syntax error the database should surface rather than silently skip.
  return blockDepth > 0;
}

/**
 * Read, parse and validate every `.sql` migration in `dir`. Non-`.sql` files and dotfiles are ignored and a missing
 * directory yields `[]`. Throws on invalid names, duplicate ids, or ids that aren't consecutive from 1.
 */
export async function loadMigrationFiles(dir: string): Promise<MochiMigrationFile[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const migrations: MochiMigrationFile[] = [];
  for (const filename of entries.filter((f) => !f.startsWith('.') && f.toLowerCase().endsWith('.sql'))) {
    const match = FILE_NAME_PATTERN.exec(filename);
    const id = match ? Number(match[1]) : 0;
    if (!match || id < 1) {
      throw new Error(`Invalid migration file name: "${toPosixPath(join(dir, filename))}" — expected "<id><separator><name>.sql" with an id of 1 or more, e.g. "1_init.sql".`);
    }
    const filePath = join(dir, filename);
    // Normalize line endings so the same file hashes identically across platforms (CRLF vs LF).
    const contents = (await Bun.file(filePath).text()).replace(/\r\n/g, '\n');
    migrations.push({
      id,
      name: match[2]?.trim() || String(id),
      filename,
      path: filePath,
      contents,
      hash: new Bun.CryptoHasher('sha256').update(contents).digest('hex'),
      noTransaction: NO_TRANSACTION_DIRECTIVE.test(contents),
    });
  }

  migrations.sort((a, b) => a.id - b.id);

  for (let i = 0; i < migrations.length; i++) {
    const current = migrations[i]!;
    const previous = migrations[i - 1];
    if (previous && previous.id === current.id) {
      throw new Error(`Duplicate migration id ${current.id} in ${toPosixPath(dir)}: "${previous.filename}" and "${current.filename}".`);
    }
    if (current.id !== i + 1) {
      throw new Error(`Migration ids in ${toPosixPath(dir)} must start at 1 and be consecutive: expected ${i + 1}, found ${current.id} ("${current.filename}").`);
    }
  }

  return migrations;
}
