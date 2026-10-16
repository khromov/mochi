// `subset-font` ships no types and `@types/subset-font` can't be a devDependency (consumers typecheck our published
// .ts sources), so the slice `compiler/fontSubset.ts` calls is pinned here, as in `css-tree.d.ts`. A *script*.
declare module 'subset-font' {
  export interface SubsetFontOptions {
    targetFormat?: 'sfnt' | 'woff' | 'woff2';
    /** Pin an axis to one value, or restrict it to a narrower range. */
    variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
    /** Skip glyphs only reachable through GSUB lookups (ligatures, contextual alternates). */
    noLayoutClosure?: boolean;
    preserveNameIds?: number[];
    keepFeatures?: string[];
  }
  function subsetFont(font: Buffer, text: string, options?: SubsetFontOptions): Promise<Buffer>;
  export default subsetFont;
}
