import { uneval } from 'devalue';

/** Keyed on the global symbol registry so a marker created by one bundled copy of the framework is recognised by another. */
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

export interface SerializedValue {
  expression: string;
  /** Imports this call newly needed, in identifier order — a specifier already minted by an earlier call in the same scope is reused and not repeated here. */
  imports: { identifier: string; specifier: string }[];
}

/** Identifier allocation shared by every `compiled()` call in one module, so two calls can't both mint `__mochi_ref_0__`. */
export interface CompiledRefScope {
  imports: { identifier: string; specifier: string }[];
  seen: Map<string, string>;
}

export function createCompiledRefScope(): CompiledRefScope {
  return { imports: [], seen: new Map() };
}

/** `devalue` escapes `<`, so a value holding markup cannot close the script block it is spliced into. */
export function serializeCompiledValue(value: unknown, scope: CompiledRefScope = createCompiledRefScope()): SerializedValue {
  const before = scope.imports.length;
  const refIdentifier = (specifier: string): string => {
    let identifier = scope.seen.get(specifier);
    if (identifier === undefined) {
      identifier = `__mochi_ref_${scope.imports.length}__`;
      scope.seen.set(specifier, identifier);
      scope.imports.push({ identifier, specifier });
    }
    return identifier;
  };
  const expression = uneval(value, (v) => (isModuleRef(v) ? refIdentifier(moduleRefSpecifier(v)) : undefined));
  return { expression, imports: scope.imports.slice(before) };
}
