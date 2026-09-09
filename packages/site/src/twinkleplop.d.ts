// The @twinkleplop/* grammar packages ship TypeScript sources but no "types" condition in their exports map, so
// tsc cannot see them. Declare the one export the site uses; drop this once upstream publishes declarations.
declare module '@twinkleplop/bash' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/css' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/html' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/javascript' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/json' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/svelte' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/toml' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/typescript' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
declare module '@twinkleplop/yaml' {
  export const language: () => (code: string, options?: { line_numbers?: boolean }) => string;
}
