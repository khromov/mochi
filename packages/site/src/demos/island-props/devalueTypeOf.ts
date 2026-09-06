const INSTANCE_TYPES: Array<[new (...args: never[]) => object, string]> = [
  [Date, 'Date'],
  [RegExp, 'RegExp'],
  [Map, 'Map'],
  [Set, 'Set'],
  [URL, 'URL'],
  [URLSearchParams, 'URLSearchParams'],
  [Uint8Array, 'Uint8Array'],
];

export function typeOf(v: unknown): string {
  if (v === undefined) {
    return 'undefined';
  }
  if (v === null) {
    return 'null';
  }
  if (typeof v === 'bigint') {
    return 'BigInt';
  }
  if (typeof v === 'number') {
    if (Number.isNaN(v)) {
      return 'NaN';
    }
    if (v === Infinity) {
      return 'Infinity';
    }
    if (Object.is(v, -0)) {
      return '-0';
    }
  }
  for (const [ctor, name] of INSTANCE_TYPES) {
    if (v instanceof ctor) {
      return name;
    }
  }
  if (ArrayBuffer.isView(v)) {
    return (v as { constructor: { name: string } }).constructor.name;
  }
  if (Array.isArray(v)) {
    return 'Array';
  }
  return typeof v;
}
