# Mochi Capacitor template

One codebase, two builds:

- `src/index.ts` — the full web app, served by `Mochi.serve()` (port 3339). It also exposes the data API (`Mochi.apiDevalue()`) the mobile app consumes.
- `src/app.ts` — the mobile app, built by `Mochi.standalone()` into a static SPA (`dist/`) that Capacitor can package for iOS/Android. It reuses the same Svelte components and isomorphic code, with a hash router and `clientProps` in place of SSR and `serverProps`.

## Commands

```sh
bun run dev       # standalone app dev server with live reload (port 3338)
bun run dev:web   # the web app (port 3339) — run it alongside so the app's API calls succeed
bun run build     # prebuild the web app AND write the standalone app to dist/
bun run start     # the web app in production mode
```

## Capacitor

The Capacitor project setup is not included yet. When you add it, point `capacitor.config` at the standalone build:

```ts
webDir: 'dist',
```

`dist/index.html` references every asset with relative paths, so it works from Capacitor's webview origin as-is.

Keep the API backward-compatible: users keep old app builds installed long after you deploy new server code.
