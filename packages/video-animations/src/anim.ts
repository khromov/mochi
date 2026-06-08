// Tiny easing/interpolation kit for the time-parametrised frames.
export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Normalise t within [start, end] to 0..1.
export const norm = (t: number, start: number, end: number) => clamp((t - start) / (end - start));

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number) => t * t * t;
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smoothstep = (t: number) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};

// Spring-ish overshoot for a lively pop-in.
export const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// A scene window with symmetric fade in/out. Returns 0..1 opacity for time t.
export function windowOpacity(t: number, start: number, end: number, fade = 0.6): number {
  if (t <= start || t >= end) {
    return 0;
  }
  const fadeIn = smoothstep(norm(t, start, start + fade)); // 0 -> 1
  const fadeOut = smoothstep(norm(t, end - fade, end)); // 0 -> 1 as we approach end
  return Math.min(fadeIn, 1 - fadeOut);
}
