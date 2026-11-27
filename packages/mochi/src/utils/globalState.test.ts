import { afterEach, expect, test } from 'bun:test';
import { pinGlobal } from './globalState';

const KEY = '__mochi_global_state_test__';
const slot = globalThis as unknown as Record<string, unknown>;
const originalProto = Object.getPrototypeOf(globalThis);

// Mirrors the browser's WindowProperties object, which exposes `<p id="…">` one step up the global's prototype chain.
function exposeNamedElement(name: string, element: object): void {
  Object.setPrototypeOf(globalThis, Object.create(originalProto, { [name]: { value: element, writable: true, configurable: true } }));
}

afterEach(() => {
  Object.setPrototypeOf(globalThis, originalProto);
  delete slot[KEY];
});

test('an element exposed by DOM named access does not stand in for the pinned value', () => {
  const element = { tagName: 'P' };
  exposeNamedElement(KEY, element);
  expect(slot[KEY]).toBe(element);

  const pool = pinGlobal(KEY, () => new Set<string>());

  expect(pool).toBeInstanceOf(Set);
  expect(pinGlobal(KEY, () => new Set<string>())).toBe(pool);
});

test('the factory runs once and later calls reuse its value', () => {
  let runs = 0;
  const first = pinGlobal(KEY, () => ({ n: ++runs }));
  const second = pinGlobal(KEY, () => ({ n: ++runs }));

  expect(second).toBe(first);
  expect(runs).toBe(1);
});

test('a nullish own value is replaced', () => {
  slot[KEY] = undefined;

  expect(pinGlobal(KEY, () => 'fresh')).toBe('fresh');
});
