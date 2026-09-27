import { fromA } from './circularA.js';

export function fromB() {
  return `B(${fromA()})`;
}
