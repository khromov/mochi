// Framework-owned `.sql` files are imported `with { type: 'text' }` so bundled SSR chunks carry them inline instead of
// looking for them on disk. This file is intentionally a *script* (no top-level import/export) so `declare module`
// registers as an ambient declaration; it is pulled in via the triple-slash reference in `cache/migrations/index.ts`,
// because consumers typecheck our published .ts sources.
declare module '*.sql' {
  const sql: string;
  export default sql;
}
