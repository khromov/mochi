import { describe, it, expect } from 'bun:test';
import { rows } from '../../../docs/_components/comparisonRows';
import { branches, kitCell, mochiNote, rowsFor } from './batteries';

const nodes = branches.flatMap((branch) => branch.nodes);

// The landing diagram reads its statuses from the docs comparison table by feature name,
// so renaming a row there would otherwise silently drop it from the diagram.
describe('batteries diagram', () => {
  it('every referenced feature exists in the comparison table', () => {
    const known = new Set(rows.map((row) => row.feature));
    const missing = nodes.flatMap((node) => node.features).filter((feature) => !known.has(feature));
    expect(missing).toEqual([]);
  });

  it('only shows features Mochi fully supports', () => {
    const unsupported = nodes.filter((node) => rowsFor(node).some((row) => row.mochi.status !== 'yes'));
    expect(unsupported.map((node) => node.label)).toEqual([]);
  });

  it('gives every node a Mochi note', () => {
    expect(nodes.filter((node) => !mochiNote(node)).map((node) => node.label)).toEqual([]);
  });

  it('rates a multi-row node by its best-supported row', () => {
    const databases = nodes.find((node) => node.label === 'Databases')!;
    expect(kitCell(databases)).toEqual({ status: 'partial', note: 'node:sqlite via adapter-node on Node or Deno' });
  });

  it('tallies SvelteKit support', () => {
    const count = (status: string) => nodes.filter((node) => kitCell(node).status === status).length;
    expect({ yes: count('yes'), partial: count('partial'), no: count('no') }).toEqual({ yes: 4, partial: 3, no: 9 });
  });
});
