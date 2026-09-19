import type { FontSubsetFace } from '../compiler/ComponentRegistry';
import { normalizeRanges } from '../compiler/fontImportAttributes';

/**
 * Dev-only inline script: once fonts have loaded, walk the rendered text and warn about characters set in a subsetted
 * family that the subset can't draw (the browser silently draws them with the next font in the stack). Runs in the
 * browser because only the cascade knows which text a family ends up on.
 */
export function fontSubsetCheckScript(faces: FontSubsetFace[]): string {
  const rangesByFamily = new Map<string, FontSubsetFace['ranges']>();
  for (const face of faces) {
    const key = face.family.toLowerCase();
    rangesByFamily.set(key, [...(rangesByFamily.get(key) ?? []), ...face.ranges]);
  }
  const byFamily: Record<string, [number, number][]> = {};
  for (const [family, ranges] of rangesByFamily) {
    byFamily[family] = normalizeRanges('', ranges).map((range) => [range.lo, range.hi]);
  }
  return `(()=>{const faces=${JSON.stringify(byFamily)};const run=()=>{const missing=new Map();const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){const el=node.parentElement;if(!el||el.closest('script,style,noscript,template,#mochi-dev-toolbar'))continue;const style=getComputedStyle(el);const family=style.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g,'').toLowerCase();const ranges=faces[family];if(!ranges)continue;let text=node.data;const tt=style.textTransform;if(tt==='uppercase')text=text.toUpperCase();else if(tt==='lowercase')text=text.toLowerCase();else if(tt==='capitalize')text=text.replace(/(^|\\s)(\\S)/g,(m,a,b)=>a+b.toUpperCase());for(const ch of text){if(/\\s/.test(ch))continue;const cp=ch.codePointAt(0);if(!ranges.some(([lo,hi])=>cp>=lo&&cp<=hi)){const set=missing.get(family)||new Set();set.add(ch);missing.set(family,set)}}}for(const [family,chars] of missing){const list=[...chars].map((c)=>JSON.stringify(c)).join(', ');const msg='font subset for "'+family+'" has no glyph for '+list+' — the browser draws them with the fallback font. Add the characters to the import\\'s subset attribute.';(window.__mochi_warn||console.warn.bind(console,'[mochi]'))(msg)}};const start=()=>{(document.fonts?document.fonts.ready:Promise.resolve()).then(run)};if(document.readyState==='complete')start();else addEventListener('load',start,{once:true})})()`;
}
