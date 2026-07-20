import { isHydratable } from 'mochi-framework';

export function willHydrate(): boolean {
  return isHydratable();
}
