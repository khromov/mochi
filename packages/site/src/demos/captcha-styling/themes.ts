// Each theme's emoji/label/declarations feed both the live widget and the code
// samples rendered beside it, so what the page shows can't drift from what it does.
export const themes = {
  themed: {
    emoji: '🍡',
    label: 'Slide the mochi to the right',
    css: `--mochi-captcha-accent: var(--accent);
--mochi-captcha-accent-soft: var(--accent-soft);
--mochi-captcha-accent-soft-text: var(--accent-soft-text);
--mochi-captcha-border: var(--border);
--mochi-captcha-track-bg: var(--surface-muted);
--mochi-captcha-handle-bg: var(--surface);
--mochi-captcha-hint-text: var(--text-subtle);`,
  },

  candy: {
    emoji: '🍭',
    label: 'Slide for a tasty treat',
    css: `--mochi-captcha-accent: #d6336c;
--mochi-captcha-accent-soft: linear-gradient(90deg, #ffd6e7, #ffa8cd);
--mochi-captcha-accent-soft-text: #a61e4d;
--mochi-captcha-border: #ffa8cd;
--mochi-captcha-track-bg: #fff0f6;
--mochi-captcha-handle-bg: #fff;
--mochi-captcha-hint-text: #c2255c;`,
  },

  terminal: {
    emoji: '▶',
    label: 'SLIDE TO PROVE HUMANITY',
    css: `--mochi-captcha-radius: 0;
--mochi-captcha-accent: #33ff77;
--mochi-captcha-accent-soft: #04301a;
--mochi-captcha-accent-soft-text: #33ff77;
--mochi-captcha-border: #33ff77;
--mochi-captcha-track-bg: #04150c;
--mochi-captcha-handle-bg: #04301a;
--mochi-captcha-hint-text: #2bbd5a;
font-family: var(--font-mono);`,
  },
} as const;

export type ThemeName = keyof typeof themes;

// The values baked into each var()'s fallback in MochiCaptcha.svelte. Shown as
// the "Defaults" sample; deliberately not applied to anything.
export const defaultsSample = `/* Each var's built-in fallback. */
:root {
  --mochi-captcha-accent: #4a7c59;
  --mochi-captcha-accent-soft: #e0ebe1;
  --mochi-captcha-accent-soft-text: #2f5b3f;
  --mochi-captcha-border: #e8e4d8;
  --mochi-captcha-track-bg: #faf8f1;
  --mochi-captcha-handle-bg: #fffdf8;
  --mochi-captcha-handle-text: var(--mochi-captcha-accent);
  --mochi-captcha-hint-text: #6e756d;
  --mochi-captcha-radius: 999px;
}`;

export const rule = (selector: string, declarations: string): string => `${selector} {\n${declarations.replace(/^/gm, '  ')}\n}`;

export const markup = (theme: (typeof themes)[ThemeName]): string => `<MochiCaptcha\n  {...captcha}\n  emoji="${theme.emoji}"\n  label="${theme.label}"\n/>`;
