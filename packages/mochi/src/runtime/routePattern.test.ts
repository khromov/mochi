import { describe, expect, test } from 'bun:test';
import { patternMatchesPath } from './routePattern';

describe('patternMatchesPath', () => {
  test('literal patterns match only the exact path', () => {
    expect(patternMatchesPath('/api/ping', '/api/ping')).toBe(true);
    expect(patternMatchesPath('/api/ping', '/api/ping/')).toBe(false);
    expect(patternMatchesPath('/api/ping', '/api/pong')).toBe(false);
    expect(patternMatchesPath('/api/ping', '/api')).toBe(false);
    expect(patternMatchesPath('/api/ping', '/api/ping/extra')).toBe(false);
  });

  test('a :param segment matches one non-empty segment', () => {
    expect(patternMatchesPath('/api/users/:id', '/api/users/5')).toBe(true);
    expect(patternMatchesPath('/api/users/:id', '/api/users/5/')).toBe(false);
    expect(patternMatchesPath('/api/users/:id', '/api/users/')).toBe(false);
    expect(patternMatchesPath('/api/users/:id', '/api/users')).toBe(false);
    expect(patternMatchesPath('/api/users/:id', '/api/users/5/posts')).toBe(false);
    expect(patternMatchesPath('/:a/:b', '/one/two')).toBe(true);
  });

  test('a wildcard consumes the rest of the path', () => {
    expect(patternMatchesPath('/api/*', '/api/anything')).toBe(true);
    expect(patternMatchesPath('/api/*', '/api/deeply/nested/path')).toBe(true);
    expect(patternMatchesPath('/api/*', '/api/')).toBe(true);
    expect(patternMatchesPath('/api/*', '/api')).toBe(false);
    expect(patternMatchesPath('/api/*', '/other/thing')).toBe(false);
  });

  test('the root pattern matches only the root path', () => {
    expect(patternMatchesPath('/', '/')).toBe(true);
    expect(patternMatchesPath('/', '/about')).toBe(false);
  });
});
