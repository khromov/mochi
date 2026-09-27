/*! syntax.js — second legal banner. @preserve */

export class Modern {
  #secret = 41;
  static registry = [];
  static {
    Modern.registry.push('static-block-ran');
  }
  get secret() {
    return this.#secret + 1;
  }
  static hasSecret(o) {
    return #secret in o;
  }
}

export function NewTargetProbe() {
  return new.target === undefined ? 'called' : 'constructed';
}

export const objectSuper = {
  __proto__: { greet: () => 'proto', tag: 'base' },
  greet() {
    return `own+${super.greet()}`;
  },
};

export const bigintMath = () => (2n ** 64n).toString();

export const vFlagRegex = () => /[\p{ASCII}--[0-9]]/v.test('a') && !/[\p{ASCII}--[0-9]]/v.test('5');

export const unicodeStrings = {
  accented: 'café',
  cjk: '日本語',
  emoji: '🎉',
  zeroWidth: 'a​b',
  lineSep: `x y`,
  paraSep: 'p q',
};

// Must not be dropped: the minifier is told property reads always have side effects.
let sideEffectLog = [];
export const withGetter = {
  get tracked() {
    sideEffectLog.push('read');
    return sideEffectLog.length;
  },
};
export const getSideEffectLog = () => [...sideEffectLog];

// A @__PURE__ call whose result is unused: it is legal to drop this one, and both minifiers should agree.
function impureLooking() {
  return 1;
}
/*#__PURE__*/ impureLooking();

// A call that is NOT annotated pure and whose result is unused: it must survive.
export const retained = [];
function mustRun() {
  retained.push('mustRun');
  return 2;
}
mustRun();
