export let clicks = 0;

export function bump(by: number): number {
  clicks += by;
  return clicks;
}

export const label = (n: number) => `clicked ${n} time${n === 1 ? '' : 's'}`;
