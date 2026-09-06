import { uneval } from 'devalue';

/** Brand for `moduleRef()` markers. A symbol keyed on the global registry so a marker created by one bundled copy of the framework is recognised by another. */
const MODULE_REF = Symbol.for('mochi.moduleRef');

export interface ModuleRefMarker {
  [MODULE_REF]: string;
}

export function createModuleRef(specifier: string): ModuleRefMarker {
  if (typeof specifier !== 'string' || specifier.length === 0) {
    throw new TypeError('moduleRef() requires a non-empty module specifier.');
  }
  return { [MODULE_REF]: specifier };
}

export function isModuleRef(value: unknown): value is ModuleRefMarker {
  return typeof value === 'object' && value !== null && MODULE_REF in value;
}

export function moduleRefSpecifier(value: ModuleRefMarker): string {
  return value[MODULE_REF];
}

/** How a compiled value is turned into source. `devalue` handles Date/Map/Set/RegExp/BigInt/cycles; `json` emits `JSON.parse("…")`, which parses faster than a large object literal but only supports plain JSON. */
export type CompiledSerializer = 'devalue' | 'json' | ((value: unknown) => string);

export interface SerializedValue {
  /** JS expression source for the value. */
  expression: string;
  /** Imports this call newly needed, in identifier order — a specifier already minted by an earlier call in the same scope is reused and not repeated here. */
  imports: { identifier: string; specifier: string }[];
}

function identifierFor(index: number): string {
  return `__mochi_ref_${index}__`;
}

/** Identifier allocation shared by every `compiled()` call in one module, so two calls can't both mint `__mochi_ref_0__`. */
export interface CompiledRefScope {
  imports: { identifier: string; specifier: string }[];
  seen: Map<string, string>;
}

export function createCompiledRefScope(): CompiledRefScope {
  return { imports: [], seen: new Map() };
}

/**
 * Serialize a compiled value to inlinable source, turning any `moduleRef()` marker into a generated import identifier.
 *
 * `json` mode cannot represent module refs (they are not JSON), so a value containing one is rejected rather than
 * silently flattened to `{}`.
 */
export function serializeCompiledValue(value: unknown, serializer: CompiledSerializer = 'devalue', scope: CompiledRefScope = createCompiledRefScope()): SerializedValue {
  const before = scope.imports.length;
  const imports = () => scope.imports.slice(before);

  const refIdentifier = (specifier: string): string => {
    let identifier = scope.seen.get(specifier);
    if (identifier === undefined) {
      identifier = identifierFor(scope.imports.length);
      scope.seen.set(specifier, identifier);
      scope.imports.push({ identifier, specifier });
    }
    return identifier;
  };

  if (typeof serializer === 'function') {
    return { expression: serializer(value), imports: imports() };
  }

  if (serializer === 'json') {
    assertNoModuleRefs(value);
    return { expression: `JSON.parse(${escapeMarkup(JSON.stringify(JSON.stringify(value)))})`, imports: imports() };
  }

  const expression = uneval(value, (v) => (isModuleRef(v) ? refIdentifier(moduleRefSpecifier(v)) : undefined));
  return { expression, imports: imports() };
}

/**
 * Escape `<` inside a JS string literal.
 *
 * The expression is spliced into a Svelte script block, and a literal closing script tag in the payload would end
 * that block at the HTML-parsing layer long before the compiler sees it. `devalue` escapes this itself;
 * `JSON.stringify` does not. The escape is decoded by the JS engine, so `JSON.parse` still receives `<`.
 */
function escapeMarkup(literal: string): string {
  return literal.replaceAll('<', '\\u003C');
}

function assertNoModuleRefs(value: unknown, seen = new Set<unknown>()): void {
  if (isModuleRef(value)) {
    throw new Error(`compiled(): moduleRef(${JSON.stringify(moduleRefSpecifier(value))}) cannot be serialized with the 'json' serializer — use the default 'devalue' serializer.`);
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return;
  }
  seen.add(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    assertNoModuleRefs(child, seen);
  }
}
