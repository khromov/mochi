import { describe, expect, test } from 'bun:test';
import { parsePostgresUrl } from './postgresUrl';

describe('parsePostgresUrl', () => {
  test('names every field of the URL explicitly, decoded', () => {
    expect(parsePostgresUrl('  postgres://app%40corp:p%3Aw@db.internal:6543/my%2Ddb?sslmode=require\n').options).toEqual({
      url: 'postgres://app%40corp:p%3Aw@db.internal:6543/my%2Ddb?sslmode=require',
      hostname: 'db.internal',
      port: 6543,
      username: 'app@corp',
      password: 'p:w',
      database: 'my-db',
    });
  });

  test('leaves out what the URL does not name, so the environment still fills those gaps', () => {
    expect(parsePostgresUrl('postgres://localhost').options).toEqual({ url: 'postgres://localhost', hostname: 'localhost' });
    expect(parsePostgresUrl('postgres://user@localhost/').options).toEqual({ url: 'postgres://user@localhost/', hostname: 'localhost', username: 'user' });
    expect(parsePostgresUrl('postgres://[bad').options).toEqual({ url: 'postgres://[bad' });
  });

  test('gives equivalent URLs one key and different targets different keys', () => {
    const key = parsePostgresUrl('postgres://u:p@Host/db?b=2&a=1').key;
    expect(parsePostgresUrl('postgresql://u:p@host:5432/db?a=1&b=2').key).toBe(key);
    expect(parsePostgresUrl(' postgres://u:p@host/db?a=1&b=2 ').key).toBe(key);
    for (const other of [
      'postgres://u:p@host/other?a=1&b=2',
      'postgres://u:p@host:6432/db?a=1&b=2',
      'postgres://u2:p@host/db?a=1&b=2',
      'postgres://u:p2@host/db?a=1&b=2',
      'postgres://u:p@host/db?a=1',
    ]) {
      expect(parsePostgresUrl(other).key).not.toBe(key);
    }
  });
});
