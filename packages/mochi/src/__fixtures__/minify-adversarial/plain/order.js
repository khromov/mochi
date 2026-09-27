/*! order.js — legal banner that must survive minification. @license MIT */
export const evaluationOrder = [];
export function note(tag) {
  evaluationOrder.push(tag);
}
