import { compileDeclarativeMatchers, type DeepsecPlugin } from "deepsec/config";

const specs = [
  {
    "version": 1,
    "slug": "mochi-server-island-payload-seal",
    "description": "Mochi's AES-256-SIV deterministic authenticated-encryption envelope that seals server-island props, image-request payloads and protection clearances, plus the AAD binding that stops a token sealed for one component/filename being replayed against another.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/islands/*.ts",
      "packages/mochi/src/image/imageCrypto.ts",
      "packages/mochi/src/protection/clearance.ts",
      "packages/mochi/src/captcha/captcha.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "(?:encrypt|decrypt)Props\\s*\\(",
        "label": "server-island props token seal/open"
      },
      {
        "source": "(?:encrypt|decrypt)Payload(?:Bytes)?\\s*\\(",
        "label": "AES-SIV payload envelope"
      },
      {
        "source": "aessiv\\s*\\(",
        "label": "AES-256-SIV primitive"
      },
      {
        "source": "mochi-payload-aes-siv-v1",
        "label": "payload key-derivation label"
      },
      {
        "source": "payload:compressMinBytes",
        "label": "payload compression threshold filter"
      },
      {
        "source": "\\{\\s*aad:\\s*",
        "label": "AAD bound to a sealed payload"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "const token = encryptPayload(propsJson, { aad: componentName, compress: options.compressServerIslandProps ?? true });",
      "return decryptProps(token, componentName);",
      "const sealed = aessiv(sivKey(), ...aadComponents(opts.aad)).encrypt(inner);",
      "cachedSivKey = { secret, key: createHmac('sha512', secret).update('mochi-payload-aes-siv-v1').digest() };"
    ],
    "closesSurfaceIds": [
      "server-island-endpoint",
      "image-transform-endpoint",
      "protection-and-captcha"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-island-custom-element-loader",
    "description": "Client-side island bootstrap custom elements (mochi-server-island, mochi-hydratable-island, mochi-island-failure) and the attribute contract they read from SSR'd HTML before fetching the island endpoint and assigning its response to innerHTML.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/web-components/*.ts",
      "packages/mochi/src/islands/bootstrapMarker.ts"
    ],
    "requires": {
      "tech": [
        "svelte"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "customElements\\.define\\(\\s*['\"]mochi-[a-z-]+['\"]",
        "label": "mochi island custom-element registration"
      },
      {
        "source": "getAttribute\\(\\s*['\"](?:signed-props|component-name|component-url|props-ref|also-hydrate|server-options|hydrate-options|hydrate-on|defer-on|css-url|data-asset-prefix)['\"]\\s*\\)",
        "label": "island bootstrap attribute read"
      },
      {
        "source": "BOOTSTRAP_MARKER_ATTR|data-mochi-bootstrap",
        "label": "server-island hydration bootstrap marker"
      },
      {
        "source": "this\\.innerHTML\\s*=",
        "label": "island endpoint HTML written into the DOM"
      },
      {
        "source": "resolveIslandProps\\s*\\(|resolveComponentUrl\\s*\\(",
        "label": "island props/bundle URL resolution"
      },
      {
        "source": "__mochi_loaded_css__",
        "label": "cross-bundle island CSS tracker"
      },
      {
        "source": "islandFailureStub\\s*\\(|mochi-island-failure",
        "label": "island failure stub markup"
      },
      {
        "source": "observeVisible\\s*\\(",
        "label": "shared island visibility observer"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "customElements.define('mochi-server-island', ServerIsland);",
      "const optionsRaw = this.getAttribute('server-options');",
      "const bootstrapUrl = marker?.getAttribute(BOOTSTRAP_MARKER_ATTR);",
      "this.innerHTML = html;",
      "export const BOOTSTRAP_MARKER_ATTR = 'data-mochi-bootstrap';"
    ],
    "closesSurfaceIds": [
      "server-island-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-island-props-inline-json",
    "description": "Per-render island props dedup registry and the inlined `<script type=\"application/json\" id=\"mochi-props-N\">` block it emits, including the script-data escaping that keeps serialized props from terminating the block early.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/islands/islandPropsRegistry.ts",
      "packages/mochi/src/compiler/*.ts",
      "packages/mochi/src/web-components/*.ts"
    ],
    "requires": {
      "tech": [
        "svelte"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "emitIslandProps\\s*\\(",
        "label": "island props registration"
      },
      {
        "source": "renderIslandPropsScript\\s*\\(|injectIslandPropsBlock\\s*\\(",
        "label": "inlined props block emission"
      },
      {
        "source": "mochi-props-",
        "label": "island props script id"
      },
      {
        "source": "u003C",
        "label": "script-tag escaping in inlined props JSON"
      },
      {
        "source": "type=\"application/json\"",
        "label": "inlined props JSON script block"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function emitIslandProps(value: unknown): string {",
      "const safe = json.replace(/</g, '\\u003C');",
      "el.before(renderIslandPropsScript(ref, entry.json, entry.emitCount), { html: true });",
      "return `<script type=\"application/json\" id=\"${id}\"${shared}>${safe}</script>`;"
    ],
    "closesSurfaceIds": [
      "server-island-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-defer-island-reload-registry",
    "description": "The globalThis-pinned deferred-island registry and reload pub/sub (name validation, register/unregister, reload rounds) plus the render-time inline-vs-placeholder budget decision for nested mochi:defer call sites.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/islands/*.ts",
      "packages/mochi/src/web-components/ServerIsland.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "svelte"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "isReloadableIslandName\\s*\\(",
        "label": "deferred island name validation"
      },
      {
        "source": "\\b(?:register|unregister|reload|notify|subscribe|isReloading)Deferred\\w*\\s*\\(",
        "label": "deferred island registry operation"
      },
      {
        "source": "__mochi_deferred_island",
        "label": "globalThis-pinned deferred island registry"
      },
      {
        "source": "deferReloadState\\s*\\(|DeferReloadState",
        "label": "deferred island reload state"
      },
      {
        "source": "shouldInlineIsland\\s*\\(|serverIsland:inlineBudget|islandInline",
        "label": "server-island inline budget"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function registerDeferredIsland(name: string, island: ReloadableIsland): void {",
      "export function shouldInlineIsland(options?: unknown): boolean {",
      "const registry = () => pinGlobal('__mochi_deferred_islands__', () => new Map<string, Set<ReloadableIsland>>());",
      "export function deferReloadState(name: string): DeferReloadState {"
    ],
    "closesSurfaceIds": [
      "server-island-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-hydration-directive-boundary",
    "description": "The mochi:hydrate / mochi:defer / mochi:clientOnly call-site directive surface and the Svelte-context hydratable boundary signal that decides which subtrees ship JavaScript to the browser.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/islands/*.ts",
      "packages/mochi/src/compiler/svelteAstPreprocess.ts",
      "packages/mochi/src/compiler/ComponentRegistry.ts"
    ],
    "requires": {
      "tech": [
        "svelte"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "'mochi:(?:hydrate|defer|clientOnly)",
        "label": "island call-site directive"
      },
      {
        "source": "HYDRATABLE_CONTEXT_KEY|isHydratable\\s*\\(",
        "label": "hydratable boundary context signal"
      },
      {
        "source": "MochiDirectives|MochiDefer(?:Visible)?Options|MochiHydrateVisibleOptions|MochiClientOnlyVisibleOptions",
        "label": "island directive option types"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "  'mochi:hydrate:visible'?: boolean | MochiHydrateVisibleOptions;",
      "export const HYDRATABLE_CONTEXT_KEY: symbol = Symbol.for('mochi:hydratable');",
      "export type MochiDirectives = {",
      "  return getContext(HYDRATABLE_CONTEXT_KEY) === true;"
    ],
    "closesSurfaceIds": [
      "server-island-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-image-request-token",
    "description": "The /_mochi/image/<filename>?p=<token> endpoint's sealed request payload: the compact binary pack/unpack codec and the encrypt/decrypt pair that binds the cosmetic path filename as AAD.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/image/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "(?:encrypt|decrypt)ImageRequest\\s*\\(",
        "label": "image request token seal/open"
      },
      {
        "source": "(?:pack|unpack)ImageRequest\\s*\\(",
        "label": "image request binary codec"
      },
      {
        "source": "createImageHandler\\s*\\(",
        "label": "image transform endpoint handler"
      },
      {
        "source": "searchParams\\.get\\(\\s*['\"]p['\"]\\s*\\)",
        "label": "sealed image payload query param"
      },
      {
        "source": "aad:\\s*filename",
        "label": "filename bound as AAD"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function decryptImageRequest(token: string, filename: string): ImageRequest | null {",
      "return encryptPayloadBytes(packImageRequest(req), { aad: filename, compress });",
      "const token = url.searchParams.get('p') ?? '';",
      "export function createImageHandler(): (req: Request) => Promise<Response> {"
    ],
    "closesSurfaceIds": [
      "image-transform-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-image-source-ssrf-guard",
    "description": "The outbound image-source fetch guard: host allowlisting, private/reserved-IP rejection, per-redirect-hop revalidation and connection pinning to a validated address with SNI preserved.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/image/fetchSource.ts",
      "packages/mochi/src/image/config.ts",
      "packages/mochi/src/image/types.ts",
      "packages/mochi/src/utils/publicUrl.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "resolvePublicUrl\\s*\\(|SsrfGuardError",
        "label": "SSRF guard entry point"
      },
      {
        "source": "fetchPinned\\s*\\(|createPinnedFetchRequest\\s*\\(",
        "label": "IP-pinned outbound fetch"
      },
      {
        "source": "blockPrivateNetworks",
        "label": "private-network block switch"
      },
      {
        "source": "image:maxRedirects",
        "label": "redirect-hop cap filter"
      },
      {
        "source": "isBlockedIp\\s*\\(|ipaddr\\.process\\s*\\(",
        "label": "address range classification"
      },
      {
        "source": "allowedHosts",
        "label": "source host allowlist"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "resolved = await resolvePublicUrl(target, { allowedHosts: opts.allowedHosts, blockPrivateNetworks: opts.blockPrivateNetworks });",
      "const fetched = await fetchPinned(resolved.url, resolved.addresses, signal);",
      "const maxRedirects = applyFilter('image:maxRedirects', DEFAULT_MAX_REDIRECTS, { src });",
      "throw new SsrfGuardError('Source host resolves to a private address');"
    ],
    "closesSurfaceIds": [
      "image-transform-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-inline-asset-content-type",
    "description": "The inline-rendering content-type allowlist shared by the image original passthrough, the disk-asset routes and the dev email-attachment download — anything outside it must be rewritten and forced to attachment disposition.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/utils/inlineContentTypeSafety.ts",
      "packages/mochi/src/utils/serveDiskAsset.ts",
      "packages/mochi/src/image/*.ts",
      "packages/mochi/src/dev/emailViewerRoutes.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "safeOriginalContentType\\s*\\(",
        "label": "upstream content-type rewrite"
      },
      {
        "source": "INLINE_SAFE_IMAGE_TYPES|INLINE_SAFE_EXTRA_TYPES",
        "label": "inline-safe media type allowlist"
      },
      {
        "source": "baseContentType\\s*\\(",
        "label": "content-type normalization"
      },
      {
        "source": "serveDiskAsset\\s*\\(",
        "label": "shared disk-asset response builder"
      },
      {
        "source": "Content-Disposition",
        "label": "attachment disposition header"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function safeOriginalContentType(contentType: string): { contentType: string; attachment: boolean } {",
      "if (INLINE_SAFE_IMAGE_TYPES.has(baseContentType(contentType))) {",
      "export async function serveDiskAsset(info: { diskPath: string; contentType: string } | undefined, development: boolean): Promise<Response> {",
      "          'Content-Disposition': `${inlineSafe ? 'inline' : 'attachment'}; filename=\"${safeName}\"`,"
    ],
    "closesSurfaceIds": [
      "image-transform-endpoint",
      "dev-internal-routes"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-image-pipeline-limits",
    "description": "Resource bounds and error mapping on the public image pipeline: response-size and timeout caps, the cache stale/evict windows the Cache-Control is derived from, the periodic cache sweeper, and the ImageError status surface.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/image/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "maxResponseBytes|fetchTimeoutMs",
        "label": "source fetch size/time cap"
      },
      {
        "source": "startImageCacheSweeper\\s*\\(|image:cache-sweep",
        "label": "image cache janitor"
      },
      {
        "source": "ImageError",
        "label": "image pipeline error status mapping"
      },
      {
        "source": "timeToStale|timeToEvict",
        "label": "stale-while-revalidate window"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function startImageCacheSweeper(cache: ImageCache, intervalMs: number): () => void {",
      "throw new ImageError(413, 'Source image exceeds the maximum size');",
      "const cacheControl = resolveImageCacheControl(options.timeToStale, options.timeToEvict, development);",
      "if (Number.isFinite(declaredLength) && declaredLength > opts.maxResponseBytes) {"
    ],
    "closesSurfaceIds": [
      "image-transform-endpoint"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-captcha-pow-challenge",
    "description": "Mochi's proof-of-work captcha mint/verify/consume primitives and the hash-chain difficulty check, including the sealed bits/iat token, the timing floor, and the captcha_token/captcha_pow form fields the widget submits.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/captcha/*.ts",
      "packages/mochi/src/protection/*.ts",
      "packages/site/src/**/*.ts",
      "packages/support/src/**/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "\\b(?:mint|verify|consume|solve)Captcha\\s*\\(",
        "label": "captcha lifecycle primitive"
      },
      {
        "source": "captcha_token|captcha_pow",
        "label": "captcha form fields"
      },
      {
        "source": "CAPTCHA_AAD|deriveChain\\s*\\(|powInput\\s*\\(|leadingZeroBits\\s*\\(",
        "label": "proof-of-work derivation"
      },
      {
        "source": "captcha:(?:minAgeMs|bits|driftAllowanceMs|solveBudgetMs)",
        "label": "captcha tuning filter"
      },
      {
        "source": "MochiCaptcha(?:Auto)?\\.svelte",
        "label": "captcha widget component"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "const captcha = await verifyCaptcha(formData, { consume: false });",
      "const pow = String(formData.get('captcha_pow') ?? '');",
      "export { default as MochiCaptcha } from './MochiCaptcha.svelte';",
      "const challenge = deriveChain(token, nodeHashHex);",
      "const minAgeMs = options?.minAgeMs ?? applyFilter('captcha:minAgeMs', resolved.minAgeMs, { bits, ageMs, limitMs });"
    ],
    "closesSurfaceIds": [
      "protection-and-captcha",
      "support-app-http",
      "site-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-captcha-nonce-replay-store",
    "description": "The one-time captcha nonce stores backing replay prevention (per-process memory map and the SQLite table), their atomic consume contract, and the globalThis-pinned runtime that keeps a single store per process.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/captcha/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "(?:Memory|Sqlite)NonceStore",
        "label": "captcha nonce store implementation"
      },
      {
        "source": "NonceStore\\b",
        "label": "replay store interface"
      },
      {
        "source": "consume\\(\\s*nonce",
        "label": "atomic one-time nonce consumption"
      },
      {
        "source": "__mochi_captcha_runtime__|getCaptchaRuntime\\s*\\(",
        "label": "pinned captcha runtime/store"
      },
      {
        "source": "INSERT OR IGNORE INTO nonces|nonces_expires_at",
        "label": "SQLite nonce table"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export class SqliteNonceStore implements NonceStore {",
      "  consume(nonce: string, expiresAt: number): boolean {",
      "export function getCaptchaRuntime(): CaptchaRuntime {",
      "const result = this.db.run('INSERT OR IGNORE INTO nonces (nonce, expires_at) VALUES (?, ?)', [nonce, expiresAt]);"
    ],
    "closesSurfaceIds": [
      "protection-and-captcha"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-protection-clearance-gate",
    "description": "The proof-of-work browser gate: the sealed clearance cookie mint/validate pair with its difficulty floor and drift allowance, the per-request protect() decision that fails closed, and the /_mochi/protection/verify route.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/protection/*.ts",
      "packages/mochi/src/Mochi.ts",
      "packages/site/src/index.ts",
      "packages/site/src/demos/protection/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "mintClearanceToken\\s*\\(|hasValidClearance\\s*\\(",
        "label": "clearance cookie mint/validate"
      },
      {
        "source": "PROTECTION_AAD|PROTECTION_CLEARANCE_COOKIE|CLEARANCE_DRIFT_ALLOWANCE_MS",
        "label": "clearance token binding and bounds"
      },
      {
        "source": "createProtectionRuntime\\s*\\(|ProtectionGate\\b",
        "label": "protection gate runtime"
      },
      {
        "source": "protection/verify",
        "label": "clearance verify endpoint"
      },
      {
        "source": "MochiProtection(?:Options|Context|Kind|PageProps)|ResolvedProtectionOptions",
        "label": "protection option surface"
      },
      {
        "source": "protectFiles",
        "label": "static-file gating switch"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function mintClearanceToken(bits: number): string {",
      "if (hasValidClearance(input.cookies.get(options.cookieName), options.maxAgeMs, options.bits)) {",
      "const verifyPath = `${deps.assetPrefix}/protection/verify`;",
      "export interface MochiProtectionContext {",
      "    protectFiles: opts.protectFiles ?? true,"
    ],
    "closesSurfaceIds": [
      "protection-and-captcha"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-dev-internal-admin-route",
    "description": "Framework-internal routes registered as raw __mochiPage/__mochiApi literals and mounted only behind a development/debug flag: client bundle stats, the page-cache admin page and APIs, the dev email viewer, and the memory probe.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/dev/*.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "__mochiPage:\\s*true|__mochiApi:\\s*true",
        "label": "internal route literal bypassing Mochi.page()/Mochi.api()"
      },
      {
        "source": "build(?:ClientStats|PageCacheAdmin|EmailViewer)Routes\\s*\\(",
        "label": "dev route builder"
      },
      {
        "source": "PAGE_CACHE_ADMIN_PATH|__mochi/admin/",
        "label": "internal admin path"
      },
      {
        "source": "MOCHI_MEMORY_PROBE|__mochi/health/memory",
        "label": "env-gated memory endpoint"
      },
      {
        "source": "debugBarEnabled|emailViewerEnabled",
        "label": "dev-only route mount flag"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const PAGE_CACHE_ADMIN_PATH = '/__mochi/admin/page-cache';",
      "    __mochiApi: true,",
      "      ...(emailViewerEnabled ? buildEmailViewerRoutes(registry) : {}),",
      "if (process.env.MOCHI_MEMORY_PROBE === '1') {"
    ],
    "closesSurfaceIds": [
      "dev-internal-routes"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-dev-live-reload-socket",
    "description": "The dev-only live-reload WebSocket endpoint and watcher: the /__mochi_live_reload route registration, the per-socket entry data used to scope reload signals, and the reload-generation bookkeeping.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/dev/*.ts",
      "packages/mochi/src/web-components/LiveReload.ts",
      "packages/mochi/src/debug-bar/*.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "__mochi_live_reload",
        "label": "live-reload socket path/state"
      },
      {
        "source": "startDevWatcher\\s*\\(|liveReloadHandler",
        "label": "dev watcher and socket handler"
      },
      {
        "source": "recordReloadSignal\\s*\\(|liveReloadGreeting\\s*\\(",
        "label": "reload generation signalling"
      },
      {
        "source": "__mochiEntry|__mochiRoutePattern",
        "label": "per-socket entry scoping data"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "        '/__mochi_live_reload': liveReloadHandler,",
      "export function recordReloadSignal(affected?: Set<string>): void {",
      "export function startDevWatcher(deps: DevWatcherDeps): Promise<void> {",
      "        __mochiRoutePattern: '/__mochi_live_reload',"
    ],
    "closesSurfaceIds": [
      "dev-internal-routes"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-dev-email-outbox",
    "description": "The in-memory dev outbox the `dev` email transport captures into, and the accessors the dev-only viewer and its attachment download route read back — including raw attachment bytes that must stay off the rendered page.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/email/*.ts",
      "packages/mochi/src/dev/emailViewerRoutes.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "\\b(?:recordDevEmail|getDevEmails|getDevEmail|getDevAttachment|clearDevOutbox|onDevEmailRecorded)\\s*\\(",
        "label": "dev outbox accessor"
      },
      {
        "source": "StoredAttachment|StoredEmail",
        "label": "captured message shape"
      },
      {
        "source": "_mochi/email",
        "label": "dev email viewer path"
      },
      {
        "source": "class DevTransport",
        "label": "capture-only dev transport"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function getDevAttachment(id: string, index: number): StoredAttachment | undefined {",
      "    recordDevEmail(message);",
      "class DevTransport implements EmailTransport {",
      "export function clearDevOutbox(): void {"
    ],
    "closesSurfaceIds": [
      "dev-internal-routes",
      "email-delivery"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-debug-bar-server-data",
    "description": "The dev toolbar's server-to-browser data channel: the per-request debugBarData bag, the window.__mochi_debug payload injected into the HTML shell (request headers, cookies, decoded server-island props), and the toolbar's panel/state keys.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/debug-bar/*.ts",
      "packages/mochi/src/dev/*.ts",
      "packages/mochi/src/runtime/requestSetup.ts",
      "packages/mochi/src/runtime/requestContext.ts",
      "packages/mochi/src/islands/serverIslandCrypto.ts",
      "packages/mochi/src/Mochi.ts"
    ],
    "requires": {
      "tech": [
        "svelte"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "__mochi_debug",
        "label": "debug payload exposed on window"
      },
      {
        "source": "debugBarData",
        "label": "per-request debug data bag"
      },
      {
        "source": "DebugBarRuntimeData|DebugBarData",
        "label": "debug payload shape"
      },
      {
        "source": "mochi:debug:",
        "label": "debug bar localStorage key"
      },
      {
        "source": "debugBarState|mochi-dev-toolbar",
        "label": "dev toolbar mount/state"
      },
      {
        "source": "CONFIGURABLE_PANELS|parseHiddenPanels\\s*\\(",
        "label": "toolbar panel settings"
      },
      {
        "source": "__mochi_font_subsets",
        "label": "dev-only font subset probe data"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "    __mochi_debug?: DebugBarRuntimeData;",
      "export const HIDDEN_PANELS_KEY = 'mochi:debug:hidden-panels';",
      "export const debugBarState = $state({",
      "const faces = window.__mochi_font_subsets ?? {};",
      "      ctx.debugBarData.serverProps[token] = JSON.stringify(devalParse(propsJson), jsonSafeReplacer, 2);"
    ],
    "closesSurfaceIds": [
      "dev-internal-routes"
    ]
  },
  {
    "version": 1,
    "slug": "support-newsletter-embed-csp",
    "description": "The cross-origin newsletter widget's framing boundary: the frame-ancestors allow-list builder, its env override, and the SUPPORT_DEV opt-in that widens it to localhost — the same list the guest's postMessage listener authorises against.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/support/src/**/*.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "packages/support/package.json"
      ]
    },
    "patterns": [
      {
        "source": "embedAncestors\\s*\\(",
        "label": "frame-ancestors allow-list builder"
      },
      {
        "source": "frame-ancestors",
        "label": "embed CSP directive"
      },
      {
        "source": "NEWSLETTER_EMBED_ANCESTORS|NEWSLETTER_EMBED_PATH",
        "label": "embed origin override / embed path"
      },
      {
        "source": "isSupportDev\\s*\\(",
        "label": "dev-mode security boundary opt-in"
      },
      {
        "source": "X-Robots-Tag",
        "label": "embed response hardening header"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function embedAncestors(env: Record<string, string | undefined> = process.env): string[] {",
      "  headers.set('Content-Security-Policy', `frame-ancestors 'self' ${embedAncestors().join(' ')}`);",
      "export function isSupportDev(env: Record<string, string | undefined> = process.env): boolean {",
      "  const configured = env.NEWSLETTER_EMBED_ANCESTORS?.trim();"
    ],
    "closesSurfaceIds": [
      "support-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "support-newsletter-optin-token",
    "description": "Bearer-token newsletter flows where the URL token is the sole authorisation: confirm/unsubscribe lookups by token, the row-state transitions they trigger, and the mailed confirm/unsubscribe link construction.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/support/src/**/*.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "packages/support/package.json"
      ]
    },
    "patterns": [
      {
        "source": "subscriberBy(?:Confirm|Unsubscribe)Token\\s*\\(",
        "label": "token-only subscriber lookup"
      },
      {
        "source": "confirm_token|unsubscribe_token",
        "label": "opt-in token column"
      },
      {
        "source": "\\b(?:confirmSubscriber|unsubscribeSubscriber|requestSubscription|claimNewsletterSend|purgeExpiredPendingSubscribers)\\s*\\(",
        "label": "subscriber state transition"
      },
      {
        "source": "confirmUrl\\s*\\(|unsubscribeUrl\\s*\\(",
        "label": "mailed token link construction"
      },
      {
        "source": "List-Unsubscribe",
        "label": "one-click unsubscribe header"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "      const subscriber = subscriberByConfirmToken(url.searchParams.get('token') ?? '');",
      "const subByUnsubStmt = db.query<Subscriber, [string]>('SELECT * FROM newsletter_subscribers WHERE unsubscribe_token = ?');",
      "          'List-Unsubscribe': `<${unsubscribe}>`,",
      "        outcome = requestSubscription({ email, source }, { cooldownMs: RESEND_COOLDOWN_MS, ttlMs: CONFIRM_TTL_MS });"
    ],
    "closesSurfaceIds": [
      "support-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-email-transport-config",
    "description": "Mochi.email transport selection and construction: the log/dev/custom/smtp switch, the SMTP credential and TLS config forwarded to nodemailer, the PII-filtering flag, and the globalThis-pinned runtime holding the pool.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/email/*.ts",
      "packages/support/src/index.ts",
      "packages/site/src/**/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "buildTransport\\s*\\(|EmailTransport\\b",
        "label": "transport construction"
      },
      {
        "source": "MochiEmailTransportConfig|MochiSmtpConfig",
        "label": "transport/SMTP config shape"
      },
      {
        "source": "createTransport\\s*\\(",
        "label": "nodemailer transporter creation"
      },
      {
        "source": "resolveEmailOptions\\s*\\(|closeEmailTransport\\s*\\(|getEmailRuntime\\s*\\(|__mochi_email_runtime__",
        "label": "pinned email runtime"
      },
      {
        "source": "filterPii",
        "label": "recipient/subject log redaction flag"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function buildTransport(config: MochiEmailTransportConfig): EmailTransport {",
      "    return nodemailer.createTransport({",
      "    filterPii: o.filterPii ?? !development,",
      "export function getEmailRuntime(): EmailRuntime {"
    ],
    "closesSurfaceIds": [
      "email-delivery"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-email-message-resolution",
    "description": "Outbound message assembly from request input: Mochi.email/sendEmail normalization of recipients, reply-to, headers and attachments, the Svelte template render path, and the email:message filter that can rewrite or veto a send before any transport.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/mochi/src/email/*.ts",
      "packages/support/src/**/*.ts",
      "packages/site/src/demos/email/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "sendEmail\\s*\\(|Mochi\\.email\\s*\\(",
        "label": "transactional send entry point"
      },
      {
        "source": "email:message",
        "label": "outgoing-message rewrite/veto filter"
      },
      {
        "source": "ResolvedEmailMessage|MochiEmailMessage",
        "label": "message shape crossing the transport boundary"
      },
      {
        "source": "renderEmailComponent\\s*\\(",
        "label": "Svelte email template render"
      },
      {
        "source": "EMAIL_TEMPLATE_DIR|scanEmailTemplates\\s*\\(",
        "label": "email template discovery"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export async function sendEmail(message: MochiEmailMessage): Promise<MochiEmailResult> {",
      "  const filtered = await applyFilter('email:message', resolved, { transport: options.transport.type });",
      "export const EMAIL_TEMPLATE_DIR = 'src/emails';",
      "      result = await Mochi.email({",
      "    html = await renderEmailComponent(runtime.registry, message.component, message.props);"
    ],
    "closesSurfaceIds": [
      "email-delivery"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-queue-job-registration",
    "description": "Mochi.queue durable job declaration and processing: the descriptor primitive, the storage validation gate, retry/dead-letter settings, and the processors that handle payloads enqueued from unauthenticated HTTP actions.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/queue.ts",
      "packages/mochi/src/Mochi.ts",
      "packages/support/src/**/*.ts",
      "packages/site/src/demos/queue/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "Mochi\\.queue\\s*[<(]",
        "label": "queue descriptor declaration"
      },
      {
        "source": "MochiQueueConfig|__mochiQueue",
        "label": "queue config/descriptor marker"
      },
      {
        "source": "isValidQueueStorage\\s*\\(|queueStorage",
        "label": "queue storage validation"
      },
      {
        "source": "retryLimit|deadLetter",
        "label": "retry and dead-letter policy"
      },
      {
        "source": "process:\\s*async",
        "label": "queue job processor"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const newsletterEmailQueue = Mochi.queue<NewsletterEmailJob>(NEWSLETTER_EMAIL_QUEUE, {",
      "export const queues: MochiQueueConfig[] = [notificationQueue];",
      "    if (!isValidQueueStorage(queueStorage)) {",
      "  process: async (job) => {"
    ],
    "closesSurfaceIds": [
      "background-queues"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-cron-job-registration",
    "description": "Mochi.cron scheduled-job declaration: the name validation regex, schedule parsing, time-zone handling, the durable cron store selection, and the registration signature the dev watcher re-reads.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/cron.ts",
      "packages/mochi/src/Mochi.ts",
      "packages/mochi/src/dev/devWatcher.ts",
      "packages/support/src/**/*.ts",
      "packages/site/src/demos/cron/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "Mochi\\.cron\\s*\\(",
        "label": "cron job declaration"
      },
      {
        "source": "createCronJob\\s*\\(|__mochiCron|cronSignature\\s*\\(",
        "label": "cron descriptor primitive"
      },
      {
        "source": "MochiCron(?:Config|Options|Handler|Run|Job|RuntimeOptions)",
        "label": "cron config surface"
      },
      {
        "source": "cronStorage|startCronRuntime\\s*\\(",
        "label": "durable cron store"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const purgeExpiredSubscribers = Mochi.cron('newsletter-purge-expired', '15 3 * * *', () => {",
      "export function createCronJob(name: string, schedule: string, config: MochiCronOptions | MochiCronHandler): MochiCronJob {",
      "export const cron: MochiCronConfig[] = [activityLog];",
      "        await startCronRuntime(cron, { cronStorage: serveOptions.cronStorage ?? 'memory', development: true, jitterMs: 0 });"
    ],
    "closesSurfaceIds": [
      "scheduled-cron"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-ws-sse-route",
    "description": "Mochi.ws and Mochi.sse long-lived connection registration: the upgrade callback that can reject a socket, frame-size and idle limits, per-socket data, and SSE stream send/close handling.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/*/src/**/*.ts",
      "packages/*/src/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "Mochi\\.(?:ws|sse)\\s*[<(]",
        "label": "WebSocket/SSE route registration"
      },
      {
        "source": "MochiWs(?:Handlers|Config|Data)|MochiSse(?:Handler|Config|Stream)",
        "label": "stream handler types"
      },
      {
        "source": "isMochiWs\\b|isMochiSse\\b",
        "label": "stream route dispatch"
      },
      {
        "source": "maxPayloadLength|idleTimeout",
        "label": "socket frame/idle limits"
      },
      {
        "source": "stream\\.onClose\\s*\\(",
        "label": "SSE teardown handler"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "      return Mochi.ws<ChatSocketData>({",
      "  '/sse/admin/stock': Mochi.sse((stream) => {",
      "  static ws<T = unknown>(handlers: MochiWsHandlers<T>): MochiWsConfig {",
      "    stream.onClose(() => clearInterval(interval));"
    ],
    "closesSurfaceIds": [
      "websocket-and-sse-streams",
      "demos-app-http",
      "site-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-route-map-registration",
    "description": "Application route maps registered through Mochi.page/Mochi.api/Mochi.file and mounted by Mochi.serve — the per-app entry list of publicly reachable paths, their serverProps resolvers and form-action handlers.",
    "noiseTier": "noisy",
    "filePatterns": [
      "packages/*/src/**/routes.ts",
      "packages/*/src/routes.ts",
      "packages/*/src/index.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "Mochi\\.(?:page|api|file)\\s*\\(",
        "label": "page/api/file route registration"
      },
      {
        "source": "Record<string,\\s*MochiRouteValue>",
        "label": "Mochi route map export"
      },
      {
        "source": "MochiRouteValue",
        "label": "route map value type"
      },
      {
        "source": "Mochi\\.serve\\s*\\(",
        "label": "server entry mounting the route map"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const routes: Record<string, MochiRouteValue> = {",
      "  '/demos/captcha': Mochi.page('./src/demos/captcha/Captcha.svelte', {",
      "  '/api/admin/products': Mochi.api(async () => {",
      "await Mochi.serve({ port: 3333, routes, handle });"
    ],
    "closesSurfaceIds": [
      "site-app-http",
      "demos-app-http",
      "support-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-demo-source-publication",
    "description": "The demo source-file registry that publishes repo files to the browser: each demo's SourceSpec list of repo-relative paths and the loadSources() reader feeding both the demo page and the public /demos/<slug>/llms.txt route.",
    "noiseTier": "noisy",
    "filePatterns": [
      "packages/site/src/demos/**/files.ts",
      "packages/site/src/demos/**/sources.prerender.ts",
      "packages/site/src/lib/demos.ts",
      "packages/site/src/components/*.ts"
    ],
    "requires": {
      "sentinelFiles": [
        "packages/site/package.json"
      ]
    },
    "patterns": [
      {
        "source": "SourceSpec",
        "label": "published source spec"
      },
      {
        "source": "loadSources\\s*\\(",
        "label": "disk read of published demo sources"
      },
      {
        "source": "path:\\s*'\\./src/",
        "label": "repo-relative path published to the demo page"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const files: SourceSpec[] = [",
      "export const sources = await loadSources(files);",
      "  { label: 'routes.ts', path: './src/demos/captcha/routes.ts' },",
      "  { label: 'index.ts', path: './src/demoIndex.ts' },"
    ],
    "closesSurfaceIds": [
      "site-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "hn-untrusted-html-allowlist",
    "description": "The HN clone's allowlist sanitizer for third-party user-authored HTML: the tag/attribute allowlist HTMLRewriter pass, the http(s)-only URL normalizer feeding href, and the rel hardening applied to surviving links.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/demos/src/hn/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/demos/package.json"
      ]
    },
    "patterns": [
      {
        "source": "sanitizeHtml\\s*\\(",
        "label": "untrusted HTML sanitizer"
      },
      {
        "source": "safeUrl\\s*\\(",
        "label": "protocol allowlist URL normalizer"
      },
      {
        "source": "allowedTags|removeTags",
        "label": "tag allowlist/denylist"
      },
      {
        "source": "new HTMLRewriter\\(\\)",
        "label": "streaming HTML rewrite pass"
      },
      {
        "source": "nofollow noopener noreferrer",
        "label": "outbound link rel hardening"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function sanitizeHtml(html: string): string {",
      "export function safeUrl(url: string | undefined | null): string | null {",
      "          el.setAttribute('rel', 'nofollow noopener noreferrer');",
      "const allowedTags = new Set(['p', 'a', 'i', 'b', 'code', 'pre']);"
    ],
    "closesSurfaceIds": [
      "demos-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "hn-upstream-api-fetch",
    "description": "The HN clone's outbound fetches to the third-party Firebase API and the cache they populate: id/type validation before a request is made, the request-path interpolation, and the shared item cache keys.",
    "noiseTier": "normal",
    "filePatterns": [
      "packages/demos/src/hn/*.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/demos/package.json"
      ]
    },
    "patterns": [
      {
        "source": "hacker-news\\.firebaseio\\.com",
        "label": "third-party upstream base URL"
      },
      {
        "source": "\\bfetch(?:Item|User|StoryIds|Stories|CommentTree)\\s*\\(",
        "label": "upstream fetch helper"
      },
      {
        "source": "itemCache",
        "label": "upstream response cache"
      },
      {
        "source": "new MochiCache\\s*\\(",
        "label": "cache construction"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "const BASE = 'https://hacker-news.firebaseio.com/v0';",
      "export async function fetchUser(username: string): Promise<HNUser | null> {",
      "export const itemCache = new MochiCache({",
      "  return itemCache.fetch(`item:${id}`, async () => {"
    ],
    "closesSurfaceIds": [
      "demos-app-http"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-server-only-module-boundary",
    "description": "The build-time boundary deciding what server code may reach the browser: the server-only module resolve guard, the .server.ts/.server.svelte export stubbing scan, the MOCHI_CLIENT client-bundle define, and the mochi-env virtual module's client stubs.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/compiler/*.ts",
      "packages/mochi/src/utils/serverOnly.ts",
      "packages/mochi/src/utils/env.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "assertServerOnly\\s*\\(|IS_CLIENT_BUNDLE",
        "label": "runtime server-only backstop"
      },
      {
        "source": "serverOnlyModuleGuard|SERVER_ONLY_MODULES",
        "label": "client-build resolve guard"
      },
      {
        "source": "scanServerOnlyExports\\s*\\(|buildServerOnlyStubModule\\s*\\(",
        "label": "server-only export stubbing"
      },
      {
        "source": "MOCHI_CLIENT|CLIENT_BUILD_DEFINE|clientBuildDefine\\s*\\(",
        "label": "client bundle define"
      },
      {
        "source": "namespace:\\s*['\"]mochi-env['\"]|registerMochiEnvClient\\s*\\(",
        "label": "mochi-env virtual module shadowing"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export function assertServerOnly(api: string, why: string): void {",
      "export const serverOnlyModuleGuard: BunPlugin = {",
      "export function scanServerOnlyExports(source: string): ScanResult {",
      "export function registerMochiEnvClient(build: PluginBuilder, development: boolean): void {",
      "export const CLIENT_BUILD_DEFINE = { MOCHI_CLIENT: 'true' } as const;"
    ],
    "closesSurfaceIds": [
      "compiler-and-server-only-boundary"
    ]
  },
  {
    "version": 1,
    "slug": "mochi-prerender-module-inlining",
    "description": "The *.prerender.ts pipeline that evaluates a module at build time and replaces it with its devalue-serialized exports, plus the moduleRef() marker that keeps an export a real runtime import — the seam where build-time values get baked into shipped code.",
    "noiseTier": "precise",
    "filePatterns": [
      "packages/mochi/src/compiler/*.ts",
      "packages/mochi/src/moduleRef.ts"
    ],
    "requires": {
      "tech": [
        "bun"
      ],
      "sentinelFiles": [
        "packages/mochi/package.json"
      ]
    },
    "patterns": [
      {
        "source": "PRERENDER_MODULE_FILTER|isPrerenderModulePath\\s*\\(|assertNotPrebuilt\\s*\\(",
        "label": "prerender module detection"
      },
      {
        "source": "\\b(?:evaluatePrerenderModule|emitPrerenderModule|createPrerenderModuleLoader)\\s*\\(",
        "label": "build-time module evaluation"
      },
      {
        "source": "serializePrerenderValue\\s*\\(|createPrerenderRefScope\\s*\\(|ModuleRefMarker",
        "label": "prerendered value serialization"
      },
      {
        "source": "\\bmoduleRef\\s*\\(|createModuleRef\\s*\\(",
        "label": "preserved runtime import marker"
      }
    ],
    "excludeFilePatterns": [
      "**/*.test.ts",
      "**/*.d.ts"
    ],
    "examples": [
      "export const PRERENDER_MODULE_FILTER = /\\.prerender\\.[jt]s$/;",
      "export function evaluatePrerenderModule(filePath: string, ctx: PrerenderContext): Promise<Namespace> {",
      "export function createModuleRef(specifier: string): ModuleRefMarker {",
      "export function serializePrerenderValue(value: unknown, scope: PrerenderRefScope = createPrerenderRefScope()): SerializedValue {"
    ],
    "closesSurfaceIds": [
      "compiler-and-server-only-boundary"
    ]
  }
];

export const generatedMatchersPlugin: DeepsecPlugin = {
  name: "deepsec-generated-matchers",
  matchers: compileDeclarativeMatchers(specs),
};
