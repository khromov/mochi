import { describe, expect, test } from 'bun:test';
import { trailingSlashIt } from './trailingSlash';

describe('trailingSlashIt', () => {
  test('appends a slash to a bare path', () => {
    expect(trailingSlashIt('/docs/intro')).toBe('/docs/intro/');
  });

  test('does not double-slash an already-slashed path', () => {
    expect(trailingSlashIt('/docs/intro/')).toBe('/docs/intro/');
  });

  test('leaves the root path untouched', () => {
    expect(trailingSlashIt('/')).toBe('/');
  });

  test('slashes the path, not the query string', () => {
    expect(trailingSlashIt('/search?q=mochi')).toBe('/search/?q=mochi');
    expect(trailingSlashIt('/search/?q=mochi')).toBe('/search/?q=mochi');
  });

  test('slashes the path, not the fragment', () => {
    expect(trailingSlashIt('/docs/intro#install')).toBe('/docs/intro/#install');
  });

  test('handles a query string and fragment together', () => {
    expect(trailingSlashIt('/docs/intro?tab=cli#install')).toBe('/docs/intro/?tab=cli#install');
  });
});
