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
  // Read only from inside the `eval` below, which is exactly the point: a direct eval sees the enclosing scope, so a
  // minifier that renames `local` has to bail out of renaming in this function. Static analysis cannot see the use.
  // eslint-disable-next-line no-unused-vars
  const local = 7;
  // eslint-disable-next-line no-eval -- exercising direct eval is the whole point of this fixture
  const direct = eval('local + 1');
  const constructed = new Function('a', 'b', 'return a * b')(6, 7);
  return { direct, constructed };
};
