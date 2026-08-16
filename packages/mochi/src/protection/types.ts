export type MochiProtectionKind = 'page' | 'api' | 'ws' | 'sse' | 'island' | 'file' | 'fallback';

export interface MochiProtectionContext {
  kind: MochiProtectionKind;
  /** `url.pathname` — the public path after proxy resolution. */
  path: string;
  url: URL;
  request: Request;
}

export interface MochiProtectionOptions {
  enabled: boolean;
  /**
   * Return true when the request requires browser verification. Omitted, every route is protected. Framework client
   * assets, `publicDir` files, warmup self-requests, the verify endpoint, and unmatched 404s are never gated. A throw
   * counts as protected (fail closed).
   */
  protect?: (ctx: MochiProtectionContext) => boolean;
  /** Proof-of-work difficulty in leading zero bits. Default: the resolved captcha `bits` (19 unless configured). */
  bits?: number;
  /** How long a passed verification lasts before the interstitial shows again. Default: 14_400_000 (4 hours). */
  maxAgeMs?: number;
  /**
   * Svelte component rendered as the interstitial, like `errorPage` for error pages. It receives
   * {@link MochiProtectionPageProps} — spread them onto `<MochiCaptchaAuto />`. Default: a built-in centered-column
   * page with the Mochi logo.
   */
  page?: string;
}

export interface ResolvedProtectionOptions {
  enabled: boolean;
  protect?: (ctx: MochiProtectionContext) => boolean;
  bits: number;
  maxAgeMs: number;
  page?: string;
}

/** Props a custom `protection.page` component receives — everything `<MochiCaptchaAuto />` needs, ready to spread. */
export interface MochiProtectionPageProps {
  token: string;
  bits: number;
  solveBudgetMs: number;
  verifyUrl: string;
}
