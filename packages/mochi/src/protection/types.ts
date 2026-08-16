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
   * Interstitial HTML shell: a path ending in `.html` or an inline HTML string, with the
   * `{{mochi.head}}`/`{{mochi.css}}`/`{{mochi.body}}`/`{{mochi.script}}` placeholders. Default: a built-in
   * centered-column shell.
   */
  shellPage?: string;
}

export interface ResolvedProtectionOptions {
  enabled: boolean;
  protect?: (ctx: MochiProtectionContext) => boolean;
  bits: number;
  maxAgeMs: number;
  shellPage?: string;
}
