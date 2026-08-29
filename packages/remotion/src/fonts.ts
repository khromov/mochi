// Variable Fraunces (normal + italic) and static JetBrains Mono, loaded in the browser.
// The fontsource @font-face rules expose the full Fraunces axis set (opsz/SOFT/WONK/wght);
// each text site picks a cut via `fontVariationSettings` (see VARIATION below), mirroring the
// pre-instanced OTF cuts the original satori pipeline baked in.
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource/jetbrains-mono/400.css';

export const FRAUNCES = 'Fraunces Variable';
export const MONO = 'JetBrains Mono';

// Axis cuts matching the brand: playful display logo, neutral small-optical body, lighter italic dek.
export const VARIATION = {
  display: '"opsz" 144, "SOFT" 50, "WONK" 1, "wght" 400',
  body: '"opsz" 9, "SOFT" 0, "WONK" 0, "wght" 400',
  italic: '"opsz" 9, "SOFT" 0, "WONK" 0, "wght" 300',
} as const;

// Decode the cuts actually used so a frame never rasterises against the fallback font.
// Driven from a component via delayRender (see MochiVideo) — a top-level delayRender would
// fire during composition discovery and break the render.
export const loadFonts = () =>
  Promise.all([document.fonts.load(`400 16px "${FRAUNCES}"`), document.fonts.load(`italic 300 16px "${FRAUNCES}"`), document.fonts.load(`400 16px "${MONO}"`)]).then(
    () => document.fonts.ready,
  );
