// negotiator ships no types, and @types/negotiator can't be a devDependency:
// consumers typecheck our published .ts sources, so the types would have to
// ship as a runtime dependency. Instead we pin the tiny slice of the API we
// use here. This file is intentionally a *script* (no top-level import/export)
// so `declare module` registers as an ambient declaration; it is pulled in via
// the triple-slash reference in `utils.ts`.
declare module 'negotiator' {
  export default class Negotiator {
    constructor(request: { headers: Record<string, string | undefined> });
    mediaType(availableMediaTypes?: string[]): string | undefined;
    encodings(availableEncodings?: string[]): string[];
  }
}
