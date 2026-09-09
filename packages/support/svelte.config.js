export default {
  compilerOptions: {
    experimental: { async: true },
    // mochi:* directives trip this warning in svelte-check and the Svelte VS Code extension; Mochi strips them before Svelte compiles.
    warningFilter: (warning) => warning.code !== 'attribute_illegal_colon',
  },
};
