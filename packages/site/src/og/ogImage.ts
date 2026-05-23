import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

let cachedPng: Uint8Array | null = null;

async function loadFont(path: string): Promise<ArrayBuffer> {
  return Bun.file(path).arrayBuffer();
}

async function loadFonts() {
  const base = new URL('.', import.meta.url).pathname;
  const [frauncesDisplay, fraunces400, fraunces300i, jetbrainsMono] = await Promise.all([
    loadFont(`${base}fonts/fraunces-og-display.otf`),
    loadFont(`${base}fonts/fraunces-og-normal.otf`),
    loadFont(`${base}fonts/fraunces-og-italic.otf`),
    loadFont(
      new URL('../../../../node_modules/.bun/@fontsource+jetbrains-mono@5.2.8/node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff', import.meta.url)
        .pathname,
    ),
  ]);
  return [
    { name: 'Fraunces Display', data: frauncesDisplay, weight: 400 as const, style: 'normal' as const },
    { name: 'Fraunces', data: fraunces400, weight: 400 as const, style: 'normal' as const },
    { name: 'Fraunces', data: fraunces300i, weight: 300 as const, style: 'italic' as const },
    { name: 'JetBrains Mono', data: jetbrainsMono, weight: 400 as const, style: 'normal' as const },
  ];
}

function buildMarkup() {
  return {
    type: 'div',
    props: {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'linear-gradient(135deg, #2b3d33 0%, #4a7c59 100%)',
        textAlign: 'center' as const,
        overflow: 'hidden',
      },
      children: {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column' as const,
            alignItems: 'center',
            maxWidth: 960,
            padding: '0 64px',
          },
          children: [
            {
              type: 'span',
              props: {
                style: {
                  fontFamily: 'Fraunces Display',
                  fontSize: 128,
                  fontWeight: 400,
                  color: '#fff',
                  letterSpacing: '-0.015em',
                  lineHeight: 1.05,
                },
                children: '🍡 mochi',
              },
            },
            {
              type: 'p',
              props: {
                style: {
                  fontFamily: 'Fraunces',
                  fontWeight: 400,
                  color: '#fff',
                  fontSize: 48,
                  lineHeight: 1.25,
                  letterSpacing: '-0.003em',
                  marginTop: 16,
                },
                children: 'A new SSR-first framework for Svelte 5 and Bun.',
              },
            },
            {
              type: 'p',
              props: {
                style: {
                  fontFamily: 'Fraunces',
                  fontStyle: 'italic',
                  fontWeight: 300,
                  color: '#f0f4f1',
                  fontSize: 29.6,
                  lineHeight: 1.4,
                  letterSpacing: '0.003em',
                },
                children: 'Partial Hydration · Best-in-class performance · full SSR support · Forms · Realtime WebSockets and SSE',
              },
            },
            {
              type: 'span',
              props: {
                style: {
                  fontFamily: 'JetBrains Mono',
                  fontSize: 22.4,
                  color: 'rgba(224, 232, 226, 0.85)',
                  letterSpacing: '0.04em',
                  marginTop: 32,
                },
                children: 'mochi.fast',
              },
            },
          ],
        },
      },
    },
  };
}

function injectNoise(svg: string): string {
  const filterDef = `
    <filter id="bg-noise" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="4" stitchTiles="stitch" result="noise"/>
      <feColorMatrix type="saturate" values="0" in="noise" result="mono"/>
      <feComponentTransfer in="mono" result="faded">
        <feFuncA type="linear" slope="0.15"/>
      </feComponentTransfer>
      <feBlend mode="overlay" in="SourceGraphic" in2="faded"/>
    </filter>`;

  if (svg.includes('</defs>')) {
    svg = svg.replace('</defs>', `${filterDef}</defs>`);
  } else {
    svg = svg.replace(/(<svg[^>]*>)/, `$1<defs>${filterDef}</defs>`);
  }

  svg = svg.replace(/<rect /, '<rect filter="url(#bg-noise)" ');

  return svg;
}

async function generateOgPng(): Promise<Uint8Array> {
  if (cachedPng) {
    return cachedPng;
  }

  const fonts = await loadFonts();
  const markup = buildMarkup();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svg = await satori(markup as any, {
    width: 1200,
    height: 630,
    fonts,
    loadAdditionalAsset: async (languageCode, segment) => {
      if (languageCode === 'emoji') {
        const code = segment.codePointAt(0)?.toString(16);
        if (!code) {
          return '';
        }
        const res = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${code}.svg`);
        if (!res.ok) {
          return '';
        }
        const svgText = await res.text();
        return `data:image/svg+xml;base64,${btoa(svgText)}`;
      }
      return '';
    },
  });

  const svgWithNoise = injectNoise(svg);

  const resvg = new Resvg(svgWithNoise, {
    fitTo: { mode: 'width', value: 1200 },
  });
  const pngData = resvg.render();
  const png = pngData.asPng();

  cachedPng = png;
  return png;
}

export const ogPngRoute: MochiRouteValue = Mochi.api(async () => {
  const png = await generateOgPng();
  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable',
    },
  });
});
