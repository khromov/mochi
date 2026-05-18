# Mochi vs SvelteKit

|                        | **Mochi**                                  | **SvelteKit**                                             |
| ---------------------- | ------------------------------------------ | --------------------------------------------------------- |
| **Default JS shipped** | Zero — opt-in per component                | Everything — full hydration                               |
| **Hydration modes**    | Eager, lazy (viewport), server island      | Eager only                                                |
| **Runtime**            | Bun only                                   | Adapter ecosystem: Node, Cloudflare, Vercel, Netlify, ... |
| **Routing**            | Route object                               | File-based (`+page.svelte`)                               |
| **WebSockets**         | Built-in (Bun native)                      | Not available                                             |
| **SSE**                | Built-in                                   | Not available                                             |
| **Bundler**            | Bun                                        | Vite                                                      |
| **Middleware**         | Yes (`hooks.ts` or Bun.serve() middleware) | Yes (`hooks.server.ts`)                                   |
| **Ecosystem**          | Small, early stage                         | Large, battle-tested                                      |
| **Best for**           | Content sites, performance,                | SPAs, multi-platform, broad deployment                    |
