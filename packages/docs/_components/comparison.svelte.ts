// Shared open/closed state for the ComparisonTable, reactive across separately
// hydrated islands (the table itself and the "Expand the table" link).
// `null` means "no user interaction yet — fall back to the per-instance default".
let open: boolean | null = $state(null);

export function comparisonOpen(): boolean | null {
  return open;
}

export function setComparisonOpen(value: boolean): void {
  open = value;
}
