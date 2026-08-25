import { preprocess as sveltePreprocess, type PreprocessorGroup } from 'svelte/compiler';
import { applyFilter } from '../extensions';

// The `compile:preprocessors` filter is sync; only applying its preprocessors through Svelte's `preprocess()` is async.
export async function applyUserPreprocessors(source: string, filename: string, target: 'server' | 'client', development: boolean): Promise<string> {
  const userPreprocessors: PreprocessorGroup[] = applyFilter('compile:preprocessors', [], {
    filename,
    target,
    development,
  });
  // `builtinTsPreprocessor` runs last so it also strips TS that user preprocessors emit, and it decides TS-ness from the
  // parsed `attributes` Svelte hands each hook.
  //
  // With no user preprocessors, that builtin pass is the only work left and it fires solely on `attributes.lang === 'ts'`.
  // A `lang="ts"` attribute always contains the literal substring `lang` whatever the quoting, so the gate below can only
  // false-positive — harmlessly re-parsing a "lang"-containing plain-JS file — and skips the full parse for plain JS.
  if (userPreprocessors.length === 0 && !source.includes('lang')) {
    return source;
  }
  const result = await sveltePreprocess(source, [...userPreprocessors, builtinTsPreprocessor], { filename });
  return result.code;
}

// Svelte 5's native TS stripping is incomplete — it throws on constructor parameter properties — so Bun's transpiler runs
// over `<script lang="ts">` first, the same treatment the `.svelte.[jt]s` rune-module loaders apply. `transformSync` leaves
// tree-shaking alone, so value imports referenced only in the template survive.
const tsScriptTranspiler = new Bun.Transpiler({ loader: 'ts' });
export const builtinTsPreprocessor: PreprocessorGroup = {
  name: 'mochi-ts',
  script({ content, attributes }) {
    if (attributes.lang !== 'ts') {
      return;
    }
    // `lang="ts"` must STAY on the tag: it also puts the template in TS mode (snippet parameter types, `as` casts in
    // markup), which Bun never sees, so dropping it makes svelte parse those as plain JS and fail. `transformSync` emits
    // no source map, so positions after a transpiled script drift by its reprinted line-count delta.
    return { code: tsScriptTranspiler.transformSync(content) };
  },
};
