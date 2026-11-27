// Framework stores import their migration `.sql` files `with { type: 'text' }`, which a bundler inlines as a string.
declare module '*.sql' {
  const contents: string;
  export default contents;
}
