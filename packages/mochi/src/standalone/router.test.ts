import { describe, expect, test } from 'bun:test';
import { matchRoute, resolveRoute } from './router';
import type { MochiPageConfig } from '../types';

function page(componentPath: string): MochiPageConfig {
  return { __mochiPage: true, componentPath };
}

describe('matchRoute', () => {
  test('matches a static path exactly', () => {
    expect(matchRoute('/', '/')).toEqual({});
    expect(matchRoute('/about', '/about')).toEqual({});
    expect(matchRoute('/about', '/other')).toBeNull();
  });

  test('captures :param segments', () => {
    expect(matchRoute('/todos/:id', '/todos/42')).toEqual({ id: '42' });
    expect(matchRoute('/a/:x/b/:y', '/a/1/b/2')).toEqual({ x: '1', y: '2' });
  });

  test('decodes captured params', () => {
    expect(matchRoute('/tags/:name', '/tags/caf%C3%A9')).toEqual({ name: 'café' });
  });

  test('rejects length mismatches', () => {
    expect(matchRoute('/todos/:id', '/todos')).toBeNull();
    expect(matchRoute('/todos', '/todos/42')).toBeNull();
  });

  test('ignores trailing slashes via empty-segment filtering', () => {
    expect(matchRoute('/about', '/about/')).toEqual({});
    expect(matchRoute('/todos/:id', '/todos/42/')).toEqual({ id: '42' });
  });
});

describe('resolveRoute', () => {
  test('prefers a static pattern over a :param pattern regardless of declaration order', () => {
    const routes = {
      '/todos/:id': page('./src/Todo.svelte'),
      '/todos/new': page('./src/NewTodo.svelte'),
    };
    expect(resolveRoute(routes, '/todos/new')?.page.componentPath).toBe('./src/NewTodo.svelte');
    expect(resolveRoute(routes, '/todos/42')?.page.componentPath).toBe('./src/Todo.svelte');
  });

  test('returns pattern and params for a param match', () => {
    const routes = { '/todos/:id': page('./src/Todo.svelte') };
    const match = resolveRoute(routes, '/todos/42');
    expect(match?.pattern).toBe('/todos/:id');
    expect(match?.params).toEqual({ id: '42' });
  });

  test('returns null when nothing matches', () => {
    expect(resolveRoute({ '/': page('./src/Home.svelte') }, '/missing')).toBeNull();
  });
});
