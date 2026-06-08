// Shared rendering pipeline: load fonts, satori markup -> SVG (+ grain) -> PNG.
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { buildFrame } from './frame';
import { CANVAS } from './theme';
import { FONTS_DIR } from './fonts-dir';

export type Font = { name: string; data: ArrayBuffer; weight: 400 | 300; style: 'normal' | 'italic' };

export async function loadFonts(): Promise<Font[]> {
  const f = async (n: string) => Bun.file(`${FONTS_DIR}/${n}`).arrayBuffer();
  const [display, normal, italic, mono] = await Promise.all([f('fraunces-display.otf'), f('fraunces-normal.otf'), f('fraunces-italic.otf'), f('jetbrains-mono.otf')]);
  return [
    { name: 'Fraunces Display', data: display, weight: 400, style: 'normal' },
    { name: 'Fraunces', data: normal, weight: 400, style: 'normal' },
    { name: 'Fraunces', data: italic, weight: 300, style: 'italic' },
    { name: 'JetBrains Mono', data: mono, weight: 400, style: 'normal' },
  ];
}

// Overlay a faint monochrome noise texture on the gradient backdrop (the hero look).
function injectNoise(svg: string): string {
  const filter = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" result="n"/><feColorMatrix in="n" type="saturate" values="0" result="m"/><feComponentTransfer in="m" result="f"><feFuncA type="linear" slope="0.05"/></feComponentTransfer><feBlend mode="overlay" in="SourceGraphic" in2="f"/></filter>`;
  if (svg.includes('</defs>')) {
    svg = svg.replace('</defs>', `${filter}</defs>`);
  } else {
    svg = svg.replace(/(<svg[^>]*>)/, `$1<defs>${filter}</defs>`);
  }
  // Apply only to the first (root background) rect.
  return svg.replace(/<rect /, '<rect filter="url(#grain)" ');
}

export async function renderFramePng(t: number, fonts: Font[]): Promise<Uint8Array> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(buildFrame(t) as any, { width: CANVAS.width, height: CANVAS.height, fonts });
  return new Resvg(injectNoise(svg), { fitTo: { mode: 'width', value: CANVAS.width } }).render().asPng();
}
