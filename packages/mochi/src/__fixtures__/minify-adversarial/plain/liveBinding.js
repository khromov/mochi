import { note } from './order.js';

// A live `export let` binding: the importer must observe the reassignment, not a copy taken at import time.
export let counter = 0;
export function bump() {
  counter += 1;
  note(`bump:${counter}`);
}
