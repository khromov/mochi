// Vendored from `pretty-bytes@7.1.0` (MIT, Sindre Sorhus). Trimmed: no BigInt
// path (mochi only formats `number`), no `fixedWidth` (unused). Browser- and
// Bun-safe — relies only on `Math` and `Intl.NumberFormat`.

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
const BIBYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
const BIT_UNITS = ['b', 'kbit', 'Mbit', 'Gbit', 'Tbit', 'Pbit', 'Ebit', 'Zbit', 'Ybit'];
const BIBIT_UNITS = ['b', 'kibit', 'Mibit', 'Gibit', 'Tibit', 'Pibit', 'Eibit', 'Zibit', 'Yibit'];

export interface PrettyBytesOptions {
  bits?: boolean;
  binary?: boolean;
  space?: boolean;
  nonBreakingSpace?: boolean;
  signed?: boolean;
  locale?: boolean | string | string[];
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

function toLocaleString(n: number, locale: PrettyBytesOptions['locale'], options: Intl.NumberFormatOptions | undefined): string {
  if (typeof locale === 'string' || Array.isArray(locale)) {
    return n.toLocaleString(locale, options);
  }
  if (locale === true || options !== undefined) {
    return n.toLocaleString(undefined, options);
  }
  return String(n);
}

function buildLocaleOptions(options: PrettyBytesOptions): Intl.NumberFormatOptions | undefined {
  const { minimumFractionDigits, maximumFractionDigits } = options;
  if (minimumFractionDigits === undefined && maximumFractionDigits === undefined) {
    return undefined;
  }
  return {
    ...(minimumFractionDigits !== undefined && { minimumFractionDigits }),
    ...(maximumFractionDigits !== undefined && { maximumFractionDigits }),
    roundingMode: 'trunc',
  };
}

export default function prettyBytes(input: number, options?: PrettyBytesOptions): string {
  if (!Number.isFinite(input)) {
    throw new TypeError(`Expected a finite number, got ${typeof input}: ${input}`);
  }

  const opts: Required<Pick<PrettyBytesOptions, 'bits' | 'binary' | 'space' | 'nonBreakingSpace'>> & PrettyBytesOptions = {
    bits: false,
    binary: false,
    space: true,
    nonBreakingSpace: false,
    ...options,
  };

  const UNITS = opts.bits ? (opts.binary ? BIBIT_UNITS : BIT_UNITS) : opts.binary ? BIBYTE_UNITS : BYTE_UNITS;
  const separator = opts.space ? (opts.nonBreakingSpace ? ' ' : ' ') : '';

  if (opts.signed && input === 0) {
    return ` 0${separator}${UNITS[0]}`;
  }

  const isNegative = input < 0;
  const prefix = isNegative ? '-' : opts.signed ? '+' : '';
  let n = isNegative ? -input : input;

  const localeOptions = buildLocaleOptions(opts);

  if (n < 1) {
    return prefix + toLocaleString(n, opts.locale, localeOptions) + separator + UNITS[0];
  }

  const exponent = Math.min(Math.floor(opts.binary ? Math.log(n) / Math.log(1024) : Math.log10(n) / 3), UNITS.length - 1);
  n = n / (opts.binary ? 1024 : 1000) ** exponent;

  if (!localeOptions) {
    const minPrecision = Math.max(3, Math.floor(n).toString().length);
    n = Number(n.toPrecision(minPrecision));
  }

  return prefix + toLocaleString(n, opts.locale, localeOptions) + separator + UNITS[exponent];
}
