import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { toPosixPath } from '../utils';
import { parseSplits, splitStatements } from '../vendor/postgres-semicolons';

/** A directive comment that runs a migration OUTSIDE a transaction (e.g. CREATE INDEX CONCURRENTLY). */
const NO_TRANSACTION_DIRECTIVE = /--\s*migrate:no-transaction(?![\w-])/i;

/** `<id><optional _ or - separator><name>.sql` (extension is case-insensitive). */
const FILE_NAME_PATTERN = /^(\d+)[-_]?(.*)\.sql$/i;

const FORBIDDEN_TX_KEYWORDS = new Set(['BEGIN', 'COMMIT', 'END', 'ABORT']);

export interface MochiMigrationSource {
  filename: string;
  contents: string;
}

export interface MochiMigrationFile {
  id: number;
  name: string;
  filename: string;
  /** Absolute path to the file, or `dir` joined with `filename` for in-memory sources. */
  path: string;
  /** File contents with line endings normalized to LF. */
  contents: string;
  /** Parsed executable SQL statements (comments stripped). */
  statements: string[];
  /** sha256 hex of the normalized contents. */
  hash: string;
  noTransaction: boolean;
}

function findTransactionControlStatement(statements: string[]): string | null {
  for (const stmt of statements) {
    const match = /^[A-Za-z_][A-Za-z0-9_$]*(?:\s+[A-Za-z_][A-Za-z0-9_$]*){0,2}/.exec(stmt);
    if (!match) {
      continue;
    }
    const [w0 = '', w1, w2] = match[0].toUpperCase().split(/\s+/);
    if (FORBIDDEN_TX_KEYWORDS.has(w0)) {
      return w0;
    }
    if (w0 === 'START' && w1 === 'TRANSACTION') {
      return 'START TRANSACTION';
    }
    if (w0 === 'ROLLBACK' && w1 !== 'TO' && !((w1 === 'TRANSACTION' || w1 === 'WORK') && w2 === 'TO')) {
      return 'ROLLBACK';
    }
  }
  return null;
}

function parseMigrationFile(dir: string, filename: string, rawContents: string): MochiMigrationFile {
  const match = FILE_NAME_PATTERN.exec(filename);
  const id = match ? Number(match[1]) : 0;
  if (!match || !Number.isSafeInteger(id) || id < 1) {
    throw new Error(`Invalid migration file name: "${toPosixPath(join(dir, filename))}" — expected "<id><separator><name>.sql" with an id of 1 or more, e.g. "1_init.sql".`);
  }
  const filePath = join(dir, filename);
  // Normalize line endings so the same file hashes identically across platforms (CRLF vs LF).
  const contents = rawContents.replace(/\r\n/g, '\n');
  const { positions } = parseSplits(contents, true);
  const noTransaction = positions.some((pos) => typeof pos !== 'number' && contents.startsWith('--', pos[0]) && NO_TRANSACTION_DIRECTIVE.test(contents.slice(pos[0], pos[1])));
  const statements = splitStatements(contents, positions, true).filter((s) => s.length > 0);
  return {
    id,
    name: match[2]?.trim() || String(id),
    filename,
    path: filePath,
    contents,
    statements,
    hash: new Bun.CryptoHasher('sha256').update(contents).digest('hex'),
    noTransaction,
  };
}

/**
 * Read, parse and validate every `.sql` migration in `dir`. Non-`.sql` files and dotfiles are ignored and a missing
 * directory yields `[]`. Throws on invalid names, duplicate ids, ids that aren't consecutive from 1, or explicit
 * transaction-control statements inside transactional migrations.
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

  const sqlFiles = entries.filter((f) => !f.startsWith('.') && f.toLowerCase().endsWith('.sql'));
  const sources: MochiMigrationSource[] = [];
  for (const filename of sqlFiles) {
    sources.push({ filename, contents: await Bun.file(join(dir, filename)).text() });
  }
  return parseMigrationSources(dir, sources);
}

/**
 * Parse and validate migrations already in memory, under the same rules as `loadMigrationFiles`. Framework stores keep
 * theirs in source as strings, which survive bundling where a directory beside `import.meta.url` would not.
 */
export function parseMigrationSources(dir: string, sources: MochiMigrationSource[]): MochiMigrationFile[] {
  const migrations = sources.map((source) => parseMigrationFile(dir, source.filename, source.contents));

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
    if (!current.noTransaction) {
      const forbidden = findTransactionControlStatement(current.statements);
      if (forbidden) {
        throw new Error(
          `Migration "${toPosixPath(current.path)}" contains an explicit "${forbidden}" statement — each migration already runs inside a transaction; remove transaction control statements or add "-- migrate:no-transaction".`,
        );
      }
    }
  }

  return migrations;
}
