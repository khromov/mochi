// Deliberately split: the two `sideEffect*` modules and the shared `order.js` land in chunks of their own, so the
// cross-chunk cases below are exercised against real chunk boundaries rather than one inlined module.
import './sideEffectA.js';
import './sideEffectB.js';
import { evaluationOrder, note } from './order.js';
import { bump, counter } from './liveBinding.js';
import { askB } from './circularA.js';
import { Modern, NewTargetProbe, objectSuper, bigintMath, vFlagRegex, unicodeStrings, withGetter, getSideEffectLog, retained } from './syntax.js';
import { nameFacts, dynamicEval } from './names.js';

// Read before and after so a stale snapshot of the live binding is visible in the result.
const counterBefore = counter;
bump();
bump();

// Top-level await across a chunk boundary.
const lazy = await import('./lazyChunk.js');

note('entry');

export const results = {
  evaluationOrder: [...evaluationOrder],
  liveBinding: { before: counterBefore, after: (await import('./liveBinding.js')).counter },
  circular: askB(),
  lazy: lazy.lazyValue,
  importMetaIsUrl: typeof import.meta.url === 'string' && import.meta.url.length > 0,
  modern: {
    secret: new Modern().secret,
    registry: [...Modern.registry],
    brandCheck: [Modern.hasSecret(new Modern()), Modern.hasSecret({})],
    newTargetCalled: NewTargetProbe(),
    newTargetConstructed: new NewTargetProbe(),
    objectSuper: objectSuper.greet(),
    bigint: bigintMath(),
    vFlag: vFlagRegex(),
  },
  unicode: { ...unicodeStrings, lengths: Object.fromEntries(Object.entries(unicodeStrings).map(([k, v]) => [k, v.length])) },
  getterSideEffects: [withGetter.tracked, withGetter.tracked, getSideEffectLog()],
  retained: [...retained],
  names: nameFacts(),
  dynamicEval: dynamicEval(),
};
