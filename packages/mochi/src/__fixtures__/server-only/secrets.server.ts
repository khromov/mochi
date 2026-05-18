export const SERVER_ONLY_SENTINEL = 'sentinel-from-server-module-d3adb33f';

export function readSecret(): string {
  return `parsed:${SERVER_ONLY_SENTINEL}`;
}
