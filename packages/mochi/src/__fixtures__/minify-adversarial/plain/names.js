export function namedFunction() {
  return 1;
}
export class NamedClass {}
export const arrowConst = () => 2;

export const nameFacts = () => ({
  fn: namedFunction.name,
  cls: NamedClass.name,
  arrow: arrowConst.name,
  instanceCtor: new NamedClass().constructor.name,
  // Only the shape matters: both builds must agree on whether the body still contains the token.
  sourceHasReturn: /return/.test(namedFunction.toString()),
});

export const dynamicEval = () => {
  const local = 7;
  // Direct eval sees the enclosing scope, so a minifier that renames `local` must bail out of renaming here.
  const direct = eval('local + 1');
  const constructed = new Function('a', 'b', 'return a * b')(6, 7);
  return { direct, constructed };
};
