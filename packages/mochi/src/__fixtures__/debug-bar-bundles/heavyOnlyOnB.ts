// Imported by both of PageB's islands (and nothing on PageA), so code splitting
// hoists it into a chunk that only PageB's entries import.
export function heavyLabelOnlyOnB(n: number): string {
  return `heavy-only-on-b:${n.toString(36)}`;
}
