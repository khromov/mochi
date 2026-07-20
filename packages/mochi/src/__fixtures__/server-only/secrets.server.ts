export const SERVER_ONLY_SENTINEL = 'sentinel-from-server-module-d3adb33f';

/** Type-only export — islands may import this without pulling anything client-side. */
export interface Secret {
  value: string;
  typeOnlySentinel: 'type-sentinel-from-server-module-c0ffee';
}

export function readSecret(): string {
  return `parsed:${SERVER_ONLY_SENTINEL}`;
}
