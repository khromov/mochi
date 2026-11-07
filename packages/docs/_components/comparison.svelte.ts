// Shared open/closed state reactive across separately hydrated islands (the table
// and the "Expand the table" link); `null` means no interaction yet, so callers fall back to their own default.
let open: boolean | null = $state(null);

export function comparisonOpen(): boolean | null {
  return open;
}

export function setComparisonOpen(value: boolean): void {
  open = value;
}
