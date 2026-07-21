// Enables `await` in components (used by the shipped <Image> component) so
// `svelte-check` accepts it. Not published — only `src` is in package.json
// `files`. Mirrors the demo site's config.
export default {
  compilerOptions: {
    experimental: {
      async: true,
    },
  },
};
