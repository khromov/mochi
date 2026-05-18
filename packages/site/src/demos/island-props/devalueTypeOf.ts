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
  if (v instanceof Date) {
    return 'Date';
  }
  if (v instanceof RegExp) {
    return 'RegExp';
  }
  if (v instanceof Map) {
    return 'Map';
  }
  if (v instanceof Set) {
    return 'Set';
  }
  if (v instanceof URL) {
    return 'URL';
  }
  if (v instanceof URLSearchParams) {
    return 'URLSearchParams';
  }
  if (v instanceof Uint8Array) {
    return 'Uint8Array';
  }
  if (ArrayBuffer.isView(v)) {
    return (v as { constructor: { name: string } }).constructor.name;
  }
  if (Array.isArray(v)) {
    return 'Array';
  }
  return typeof v;
}
