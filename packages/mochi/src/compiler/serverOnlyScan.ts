export interface ScanResult {
  named: string[];
  hasDefault: boolean;
  warnings: string[];
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const transpiler = new Bun.Transpiler({ loader: 'ts' });

export function scanServerOnlyExports(source: string): ScanResult {
  const { exports } = transpiler.scan(source);
  const named: string[] = [];
  let hasDefault = false;
  const warnings: string[] = [];

  for (const name of exports) {
    if (name === 'default') {
      hasDefault = true;
    } else if (IDENT_RE.test(name)) {
      named.push(name);
    } else {
      warnings.push(`string-named export ${JSON.stringify(name)} is not stubbed; rename it to a plain identifier.`);
    }
  }

  // `Bun.Transpiler.scan()` does not surface re-exports through `export *`,
  // so the user gets a silent empty stub. Catch the syntactic pattern here
  // so we can flag it during the client build. Skip the regex entirely when
  // the source can't possibly contain the form — keeps the false-positive
  // surface (matches inside strings/comments) bounded to files that already
  // mention both tokens.
  if (source.includes('export') && source.includes('*') && /\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s+)?from\b/.test(source)) {
    warnings.push('`export *` re-exports are not stubbed; declare named exports in the `.server.ts` file directly.');
  }

  return { named, hasDefault, warnings };
}

export function buildServerOnlyStubModule(originalPath: string, scan: ScanResult): string {
  const escapedPath = JSON.stringify(originalPath);
  const makeStub = (name: string) => {
    const errCall = `${JSON.stringify(name)} + ' from ' + ${escapedPath} + ' was called on the client; this is a server-only export.'`;
    const errAccess = `${JSON.stringify(name)} + ' from ' + ${escapedPath} + ' is a server-only export; wrap usage in hydratable() or guard with isServer.'`;
    const safeName = IDENT_RE.test(name) && name !== 'default' ? name : '_serverOnly';
    return `new Proxy(function ${safeName}() {}, { get(_, p) { if (typeof p === 'symbol') return undefined; throw new Error(${errAccess}); }, apply() { throw new Error(${errCall}); }, construct() { throw new Error(${errCall}); } })`;
  };

  const lines: string[] = [];
  for (const name of scan.named) {
    lines.push(`export const ${name} = ${makeStub(name)};`);
  }
  if (scan.hasDefault) {
    lines.push(`const __default = ${makeStub('default')};`);
    lines.push(`export default __default;`);
  }
  if (lines.length === 0) {
    lines.push('// no exports discovered');
  }
  return lines.join('\n') + '\n';
}
