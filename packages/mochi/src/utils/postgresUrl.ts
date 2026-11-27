export interface PostgresConnectionOptions {
  url: string;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
}

export interface PostgresTarget {
  /** Spread into `new SQL({ adapter: 'postgres', … })`. */
  options: PostgresConnectionOptions;
  /** Canonical identity, equal for URLs that reach the same database with the same credentials and parameters. */
  key: string;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * Bun.SQL lets `$PGDATABASE` override the database named in a connection URL, so every field the URL names is also
 * passed as an explicit option, which the environment cannot override.
 */
export function parsePostgresUrl(rawUrl: string): PostgresTarget {
  const url = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { options: { url }, key: `postgres:${url}` };
  }
  const options: PostgresConnectionOptions = { url };
  if (parsed.hostname) {
    options.hostname = parsed.hostname;
  }
  if (parsed.port) {
    options.port = Number(parsed.port);
  }
  if (parsed.username) {
    options.username = decode(parsed.username);
  }
  if (parsed.password) {
    options.password = decode(parsed.password);
  }
  const database = decode(parsed.pathname.replace(/^\//, ''));
  if (database) {
    options.database = database;
  }
  const params = [...parsed.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const auth = `${encodeURIComponent(options.username ?? '')}:${encodeURIComponent(options.password ?? '')}`;
  const key = `postgres://${auth}@${parsed.hostname.toLowerCase()}:${options.port ?? 5432}/${encodeURIComponent(database)}${query ? `?${query}` : ''}`;
  return { options, key };
}
