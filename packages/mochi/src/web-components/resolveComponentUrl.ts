/**
 * `import()` resolves a relative specifier against the importing module, which lives under the asset prefix — every
 * other URL Mochi writes into the page resolves against the document, so anchor `component-url` there too.
 */
export function resolveComponentUrl(componentUrl: string, baseURI: string): string {
  return new URL(componentUrl, baseURI).href;
}
