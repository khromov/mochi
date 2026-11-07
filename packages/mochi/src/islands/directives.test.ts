import { expectTypeOf, test } from 'bun:test';
import type { HTMLAttributes } from 'svelte/elements';
import type { MochiDirectives } from './directives';

type Directive = 'mochi:hydrate' | 'mochi:hydrate:visible' | 'mochi:defer' | 'mochi:defer:visible' | 'mochi:clientOnly' | 'mochi:clientOnly:visible';

test('MochiDirectives names every directive the preprocessor understands', () => {
  expectTypeOf<keyof MochiDirectives>().toEqualTypeOf<Directive>();
});

test('HTML elements accept the same directives with the same option shapes', () => {
  expectTypeOf<Pick<HTMLAttributes<HTMLElement>, Directive>>().toEqualTypeOf<Pick<MochiDirectives, Directive>>();
});
