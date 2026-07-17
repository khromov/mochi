import { parse } from 'svelte/compiler';
import type { AST, CompileOptions } from 'svelte/compiler';
import MagicString from 'magic-string';
import path from 'node:path';
import { walk } from 'zimmerframe';
import { ALSO_HYDRATE_ENVELOPE_KEY, type AlsoHydrateMode } from '../types';
import { FRAMEWORK_COMPONENTS_SPECIFIER, resolveFrameworkComponent } from './frameworkComponents';

/** Svelte's AST nodes all have start/end, but estree types don't declare them. */
interface Positioned {
  start: number;
  end: number;
}

export interface HydratableComponent {
  /** Unique identity key (`<localName>_<hash>`, see `islandIdentity`) — the registry map key, `component-name` attribute, and placeholder key. */
  name: string;
  /** The bare local import identifier, for human-facing messages only (never an identity key). */
  displayName: string;
  resolvedPath: string;
  /** Export the component was imported from: `'default'` or a named export of the resolved module. */
  exportName: string;
}

export interface ServerIslandComponent {
  /** Unique identity key (`<localName>_<hash>`, see `islandIdentity`) — the registry map key, `component-name` attribute, and props AAD. */
  name: string;
  /** The bare local import identifier, for human-facing messages only (never an identity key). */
  displayName: string;
  resolvedPath: string;
  /** Export the component was imported from: `'default'` or a named export of the resolved module. */
  exportName: string;
}

/**
 * A `mochi:*` directive the preprocessor could not honour. Surfaced as a
 * compile error (via `ComponentRegistry.getErrors()`) rather than thrown, so
 * the dev error page can render it and the dev watcher can clear it on fix —
 * silently skipping would leave an inert component with no signal to the author.
 */
export interface PreprocessIslandError {
  /** Bare component name as written in the template. */
  component: string;
  /** The directive that required resolution, e.g. `mochi:hydrate:visible`. */
  directive: string;
  /** Absolute path of the file containing the directive. */
  filePath: string;
  /** Import specifier when one exists but is unsupported (bare package, namespace, non-svelte source); null when no import matched at all. */
  importSource: string | null;
}

export interface PreprocessResult {
  transformed: string;
  hydratables: HydratableComponent[];
  serverIslands: ServerIslandComponent[];
  errors: PreprocessIslandError[];
}

/**
 * Preprocess a Svelte source file to detect `mochi:hydrate`, `mochi:hydrate:visible`,
 * `mochi:defer`, `mochi:defer:visible`, and `mochi:clientOnly` on child components.
 * Uses Svelte's own parser for robust AST-based matching instead of fragile regexes.
 *
 * - `mochi:hydrate` / `mochi:hydrate:visible` → wraps in `<mochi-hydratable-island>`
 * - `mochi:defer` / `mochi:defer:visible` → wraps in `<mochi-server-island>` with
 *   encrypted props; the `:visible` variant adds `defer-on="visible"` so the client
 *   waits for IntersectionObserver before fetching
 * - Combined `mochi:defer*` + `mochi:hydrate*` → server island with `also-hydrate`
 *   attribute, registered in both lists
 * - `mochi:clientOnly` → wraps in `<mochi-hydratable-island client-only>`; the
 *   component is never invoked server-side, optional fallback markup passed as
 *   children becomes SSR placeholder content, and the client mounts (not
 *   hydrates) the component
 */
export function preprocessHydratable(source: string, filePath: string): PreprocessResult {
  if (!source.includes('mochi:hydrate') && !source.includes('mochi:defer') && !source.includes('mochi:clientOnly')) {
    return { transformed: source, hydratables: [], serverIslands: [], errors: [] };
  }
  const ast = parse(source, { modern: true });
  const s = new MagicString(source);

  // Build import map from AST: component name → relative import path.
  // Also detect an existing `const x = $props.id()` declaration — Svelte
  // allows only one per component (`props_duplicate`), so when the author
  // already has one we must reuse its identifier instead of injecting ours.
  //
  // Limitation: this only scans top-level instance-script variable
  // declarations (the idiomatic `const id = $props.id()`). A `$props.id()`
  // call nested in a function/snippet, or otherwise not bound to a top-level
  // identifier, won't be detected — we'd inject our own and Svelte would then
  // fail with `props_duplicate`. Not worth handling until someone hits it.
  const importMap = new Map<string, { source: string; exportName: string }>();
  // Local names bound by imports the island pipeline can't handle (bare package
  // specifiers, namespace imports, non-svelte sources) — kept so a directive on
  // one of them can name the offending specifier in its compile error.
  const unsupportedImports = new Map<string, string>();
  let pidVar: string | null = null;
  if (ast.instance) {
    for (const node of ast.instance.content.body) {
      if (node.type === 'ImportDeclaration' && typeof node.source.value === 'string') {
        const importSource = node.source.value;
        // The framework's own public components resolve to their on-disk
        // `.svelte` so a directive can sit directly on the package import
        // (`<MochiCaptcha mochi:hydrate />`) — no local wrapper needed. Named
        // imports only; an unknown name or a default/namespace import falls
        // through to the normal unresolved-island error.
        if (importSource === FRAMEWORK_COMPONENTS_SPECIFIER) {
          for (const spec of node.specifiers ?? []) {
            const framework = spec.type === 'ImportSpecifier' && spec.imported.type === 'Identifier' ? resolveFrameworkComponent(spec.imported.name) : null;
            if (framework) {
              importMap.set(spec.local.name, { source: framework.resolvedPath, exportName: framework.exportName });
            } else {
              unsupportedImports.set(spec.local.name, importSource);
            }
          }
          continue;
        }
        const supported =
          /\.(svelte|md|svx)$/.test(importSource) && // TODO: Needs to be configurable to support arbitrary extensions
          (importSource.startsWith('./') || importSource.startsWith('../') || path.isAbsolute(importSource));
        for (const spec of node.specifiers ?? []) {
          if (supported && spec.type === 'ImportDefaultSpecifier') {
            importMap.set(spec.local.name, { source: importSource, exportName: 'default' });
          } else if (supported && spec.type === 'ImportSpecifier') {
            const exportName = spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value);
            importMap.set(spec.local.name, { source: importSource, exportName });
          } else {
            unsupportedImports.set(spec.local.name, importSource);
          }
        }
      } else if (node.type === 'VariableDeclaration') {
        for (const decl of node.declarations) {
          if (
            decl.id.type === 'Identifier' &&
            decl.init?.type === 'CallExpression' &&
            decl.init.callee.type === 'MemberExpression' &&
            decl.init.callee.object.type === 'Identifier' &&
            decl.init.callee.object.name === '$props' &&
            decl.init.callee.property.type === 'Identifier' &&
            decl.init.callee.property.name === 'id'
          ) {
            pidVar = decl.id.name;
          }
        }
      }
    }
  }
  const pid = pidVar ?? '__mochi_pid__';

  const hydratables: HydratableComponent[] = [];
  const serverIslands: ServerIslandComponent[] = [];
  const errors: PreprocessIslandError[] = [];
  const seen = new Set<string>();
  const seenServer = new Set<string>();

  // Walk the AST fragment to find Component nodes with mochi directives
  walk(ast.fragment as AST.SvelteNode, null, {
    Component(comp, { next }) {
      const directives = findMochiDirectives(comp.attributes);
      if (!directives.server && !directives.hydrate && !directives.clientOnly) {
        next();
        return;
      }

      // `islandId` is a reserved framework name on every island, rejected on
      // `mochi:clientOnly`, `mochi:defer`, and `mochi:hydrate` so the directives
      // behave the same. On `mochi:defer` it's the transport key inside the signed
      // envelope (stripped before the component renders); erroring everywhere
      // means a component can move between directives without a prop silently
      // changing meaning. For a unique id, use Svelte's `$props.id()`.
      const islandDirective = directives.clientOnly ?? directives.server ?? directives.hydrate!;

      const entry = importMap.get(comp.name);
      if (!entry) {
        // The author asked for an island the pipeline can't build — a compile
        // error, never a silent skip. For dotted names (`<NS.Widget>`), the base
        // identifier's import (if any) is the one worth naming in the message.
        const base = comp.name.split('.')[0]!;
        errors.push({
          component: comp.name,
          directive: islandDirective.name,
          filePath,
          importSource: unsupportedImports.get(comp.name) ?? unsupportedImports.get(base) ?? importMap.get(base)?.source ?? null,
        });
        next();
        return;
      }

      const resolved = path.resolve(path.dirname(filePath), entry.source);
      const exportName = entry.exportName;
      const dedupKey = `${resolved}\0${exportName}`;

      // Unique identity for this island, used everywhere the framework keys an
      // island by "name": the `component-name` attribute, the server-island
      // endpoint path, the props-encryption AAD, the `__MOCHI_*__<id>__`
      // placeholders, and the registry maps. `comp.name` alone is the bare local
      // import identifier and is NOT unique — see `islandIdentity`. `comp.name`
      // is still used below for the real Svelte tag and human-facing error text.
      // (Distinct from the reserved `islandId` prop — that's a per-render
      // instance id; this is a per-component-file identity.)
      const islandKey = islandIdentity(comp.name, resolved, exportName);

      for (const attr of comp.attributes) {
        if (attr.type === 'Attribute' && attr.name === 'islandId') {
          throw new Error(
            `\`islandId\` is a reserved framework name and cannot be passed as a prop to a \`${islandDirective.name}\` island. ` +
              `For a unique id inside ${comp.name}, use Svelte's \`$props.id()\`.`,
          );
        }
      }

      if (directives.clientOnly) {
        // --- CLIENT ONLY ---
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
        }

        // Children are the optional SSR fallback, emitted as placeholder markup
        // that's removed when the client mounts the component. Static markup only:
        // nested `mochi:*` islands here are left untransformed and wiped on mount.
        const fallback = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');

        // No islandId: nothing renders server-side, so there's no hydration id to
        // carry. The client bootstrap injects `isHydratable: true` at mount; the
        // payload itself dedups on its serialized props alone, like plain
        // hydratable islands.
        const propsExpr = buildPropsFromAst(source, comp.attributes);
        let attrs = `component-name="${islandKey}" component-url="__MOCHI_COMPONENT_URL__${islandKey}__" client-only`;
        if (propsExpr !== '{}') {
          attrs += ` props-ref={__mochi_emit_props__(${propsExpr})}`;
        }

        // `mochi:clientOnly:visible` defers `mount()` until the wrapper enters the
        // viewport, reusing the hydratable visible path; `client-only` still flips
        // `hydrate()` to `mount()`. Mirrors the `mochi:hydrate:visible` branch below.
        const isVisible = directives.clientOnly.name === 'mochi:clientOnly:visible';
        if (isVisible) {
          let visibleOptionsExpr: string | null = null;
          if (directives.clientOnly.value !== true && !Array.isArray(directives.clientOnly.value)) {
            const expr = directives.clientOnly.value.expression as unknown as Positioned;
            visibleOptionsExpr = source.slice(expr.start, expr.end);
          }
          attrs += ` hydrate-on="visible" css-url="__MOCHI_CSS_URL__${islandKey}__"`;
          if (visibleOptionsExpr) {
            attrs += ` hydrate-options={JSON.stringify(${visibleOptionsExpr})}`;
          }
        }

        // No <svelte:boundary>: the component never renders server-side, so there's
        // no SSR throw to catch and no hydration marker to force.
        const replacement = `<mochi-hydratable-island ${attrs}>${fallback}</mochi-hydratable-island>`;

        s.overwrite(comp.start, comp.end, replacement);
      } else if (directives.server) {
        // --- SERVER ISLAND ---
        if (!seenServer.has(dedupKey)) {
          seenServer.add(dedupKey);
          serverIslands.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
        }

        // Server islands only get `isHydratable: true` when also-hydrate is set
        // (i.e. `mochi:defer mochi:hydrate`); a pure `mochi:defer` is
        // SSR-only-via-fetch and never hydrates.
        //
        // The authored also-hydrate mode rides *inside the encrypted envelope*
        // (`__mochi_ah`, transport-only, stripped before render — like islandId).
        // The endpoint reads it from the decrypted payload rather than trusting the
        // `?hydrate=` query param; otherwise an attacker could append `hydrate=eager`
        // to any sealed token and have the endpoint echo the decrypted props back in
        // plaintext, turning a pure `mochi:defer` island into a decryption oracle.
        const alsoHydrateMode: AlsoHydrateMode | null = directives.hydrate ? (directives.hydrate.name === 'mochi:hydrate:visible' ? 'visible' : 'eager') : null;
        const autoEntries = directives.hydrate
          ? [`islandId: __mochi_iid`, `isHydratable: true`, `${ALSO_HYDRATE_ENVELOPE_KEY}: ${JSON.stringify(alsoHydrateMode)}`]
          : [`islandId: __mochi_iid`];
        const propsExpr = buildPropsFromAst(source, comp.attributes, autoEntries);
        // Always emit signed-props for server islands (no empty-props optimization)
        // because islandId is always injected, and all props must be encrypted
        // to prevent reading/tampering via query parameters. The component name is
        // bound as AAD so a token sealed for one component can't be replayed
        // against a different component.
        // The islandId rides inside the encrypted envelope (transport only, stripped
        // before render); there's no separate `island-id` attribute.
        let attrs = `component-name="${islandKey}" signed-props={__mochi_encrypt_props__(__mochi_stringify__(${propsExpr}), ${JSON.stringify(islandKey)})} css-url="__MOCHI_SERVER_CSS_URL__${islandKey}__" data-asset-prefix="__MOCHI_ASSET_PREFIX__"`;

        // `mochi:defer:visible` defers the fetch until the wrapper enters the
        // viewport. `rootMargin` rides inside the existing `server-options`
        // JSON so the client reads one attribute for both fetch and visibility
        // configuration.
        const isServerVisible = directives.server.name === 'mochi:defer:visible';
        if (isServerVisible) {
          attrs += ` defer-on="visible"`;
        }

        // Extract directive options (e.g. mochi:defer={{retries: 10}} or
        // mochi:defer:visible={{rootMargin: '200px', retries: 5}})
        let serverOptionsExpr: string | null = null;
        if (directives.server.value !== true && !Array.isArray(directives.server.value)) {
          const exprTag = directives.server.value;
          const expr = exprTag.expression as unknown as Positioned;
          serverOptionsExpr = source.slice(expr.start, expr.end);
        }
        if (serverOptionsExpr) {
          attrs += ` server-options={JSON.stringify(${serverOptionsExpr})}`;
        }

        // Combined: mochi:defer + mochi:hydrate/mochi:hydrate:visible
        if (directives.hydrate) {
          const isVisible = directives.hydrate.name === 'mochi:hydrate:visible';
          attrs += isVisible ? ` also-hydrate="visible"` : ` also-hydrate="eager"`;
          attrs += ` component-url="__MOCHI_COMPONENT_URL__${islandKey}__"`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
          }
        }

        // Children become fallback content
        const constDecl = `{#if true}{@const __mochi_iid = \`\${${pid}}-\${__mochi_uid__++}\`}`;
        let replacement: string;
        if (comp.fragment.nodes.length > 0) {
          const childrenSource = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');
          replacement = `${constDecl}<mochi-server-island ${attrs}>${childrenSource}</mochi-server-island>{/if}`;
        } else {
          replacement = `${constDecl}<mochi-server-island ${attrs}></mochi-server-island>{/if}`;
        }

        s.overwrite(comp.start, comp.end, replacement);
      } else {
        // --- HYDRATE / VISIBLE ONLY ---
        const mochiAttr = directives.hydrate!;

        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          hydratables.push({ name: islandKey, displayName: comp.name, resolvedPath: resolved, exportName });
        }

        // Build the non-mochi props source for the inner component tag
        const propsSource = comp.attributes
          .filter((a) => !(a.type === 'Attribute' && a.name.startsWith('mochi:')))
          .map((a) => source.slice(a.start, a.end))
          .join(' ');

        // Determine directive type and options
        const isVisible = mochiAttr.name === 'mochi:hydrate:visible';
        let visibleOptionsExpr: string | null = null;
        if (isVisible && mochiAttr.value !== true && !Array.isArray(mochiAttr.value)) {
          const exprTag = mochiAttr.value;
          const expr = exprTag.expression as unknown as Positioned;
          visibleOptionsExpr = source.slice(expr.start, expr.end);
        }

        // Build wrapper attributes
        const propsExpr = buildPropsFromAst(source, comp.attributes);
        let attrs = `component-name="${islandKey}" component-url="__MOCHI_COMPONENT_URL__${islandKey}__"`;
        // Skip props when component has no props to avoid serializing empty objects in HTML.
        // `__mochi_emit_props__` registers the payload in the per-request dedup map and
        // returns a ref id; after render ComponentRegistry's HTMLRewriter pass emits each
        // payload as a <script type="application/json"> block just before its first island.
        if (propsExpr !== '{}') {
          attrs += ` props-ref={__mochi_emit_props__(${propsExpr})}`;
        }
        if (isVisible) {
          attrs += ` hydrate-on="visible"`;
          attrs += ` css-url="__MOCHI_CSS_URL__${islandKey}__"`;
          if (visibleOptionsExpr) {
            attrs += ` hydrate-options={JSON.stringify(${visibleOptionsExpr})}`;
          }
        }

        // Build inner component with the auto-injected `isHydratable` prop —
        // a `true` boolean that lets components branch SSR-only behavior off
        // the auto-injection pipeline (no Svelte context needed). Components
        // needing a unique id use Svelte's native `$props.id()` instead.
        let innerTag: string;
        const autoProps = `isHydratable={true}`;
        if (comp.fragment.nodes.length > 0) {
          const childrenSource = comp.fragment.nodes.map((n) => source.slice(n.start, n.end)).join('');
          innerTag = `<${comp.name}${propsSource ? ' ' + propsSource : ''} ${autoProps}>${childrenSource}</${comp.name}>`;
        } else {
          innerTag = `<${comp.name}${propsSource ? ' ' + propsSource : ''} ${autoProps} />`;
        }

        // Wrap the island in <svelte:boundary> so an SSR throw inside the
        // component doesn't take down the parent page render. The boundary sits
        // OUTSIDE <mochi-hydratable-island> so its <!--[-->…<!--]--> markers
        // land at page level and are stripped by the existing stripHydrationMarkers
        // pass. On failure the island wrapper is absent from the DOM; the
        // client never attempts hydration and <mochi-island-failure> is shown
        // directly. Server-side rendering of `failed` requires `transformError`
        // to be passed to `render()` (see ComponentRegistry.renderComponent).
        //
        // TODO: The inner svelte:boundary feel wrong, there MUST be a way
        // for the hydration markers to be emitted without it, or have svelte not error
        // out when they don't match up int his case...
        //
        // The INNER `<svelte:boundary>` is essential: a bare component
        // invocation does not emit a hydration-block marker on its own.
        // Without this wrapper, `<mochi-hydratable-island>`'s firstChild is
        // the rendered DOM element, and Svelte's `hydrate()` (which walks
        // children for `<!--[-->` / HYDRATION_START) throws HYDRATION_ERROR
        // and silently falls back to `mount()` — losing real hydration and
        // breaking `hydratable()` lookups (the `hydrating` flag stays false
        // through the mount fallback).
        const failedSnippet =
          `{#snippet failed(error)}` + `<mochi-island-failure data-component=${JSON.stringify(comp.name)} data-message={error.message}></mochi-island-failure>` + `{/snippet}`;
        // The `{#if true}` wrapper gives each island its own scope: every island
        // declares a `{#snippet failed}` under the same name, and without a
        // per-island block Svelte collapses them to one shared snippet so a
        // throwing island renders a sibling island's failure stub. The block
        // adds page-level `<!--[-->…<!--]-->` markers, stripped by the existing
        // stripHydrationMarkers pass.
        const replacement =
          `{#if true}<svelte:boundary>${failedSnippet}` +
          `<mochi-hydratable-island ${attrs}><svelte:boundary>${innerTag}</svelte:boundary></mochi-hydratable-island>` +
          `</svelte:boundary>{/if}`;
        s.overwrite(comp.start, comp.end, replacement);
      }

      next();
    },
  });

  // Inject imports into the component's <script> tag
  const needsEmitProps = hydratables.length > 0;
  const needsStringify = serverIslands.length > 0;
  const needsSignProps = serverIslands.length > 0;
  // Only server islands need the `__mochi_iid` transport id, riding inside their
  // signed envelope as `idPrefix` for the standalone render. Hydratable and
  // client-only islands carry no id — Svelte recovers `$props.id()` from its own
  // `<!--$...-->` markers (client-only mints it fresh at mount).
  const needsUid = serverIslands.length > 0;

  if ((needsEmitProps || needsStringify || needsSignProps) && ast.instance) {
    const contentStart = (ast.instance.content as unknown as Positioned).start;
    let imports = '';
    if (needsEmitProps) {
      imports += '\nimport { emitIslandProps as __mochi_emit_props__ } from "mochi-framework";';
    }
    if (needsStringify) {
      imports += '\nimport { stringify as __mochi_stringify__ } from "mochi-framework";';
    }
    if (needsUid) {
      imports += '\nlet __mochi_uid__ = 0;';
      // Island ids are `${$props.id()}-${counter}`: the rune is unique per
      // component instance per render, the counter disambiguates multiple
      // islands within one instance — unique page-wide, and SSR-stable on
      // hydration because Svelte reads the id back from its `<!--$...-->`
      // comment marker.
      if (!pidVar) {
        imports += '\nconst __mochi_pid__ = $props.id();';
      }
    }
    if (needsSignProps) {
      imports += '\nimport { encryptProps as __mochi_encrypt_props__ } from "mochi-server-island-runtime";';
    }
    s.appendRight(contentStart, imports);
  }

  return { transformed: s.toString(), hydratables, serverIslands, errors };
}

/**
 * Stable, unique identity for an island. Used as the `component-name` attribute
 * (which the client web components forward to the server-island endpoint and the
 * client hydratable registry), the props-encryption AAD, and the key for every
 * registry map (`serverIslandPaths`, `componentEntryUrls`, …).
 *
 * The bare local import name is NOT unique across a project: two different
 * component files that happen to be imported under the same identifier — e.g. a
 * `Widget.svelte` in `./a` and another in `./b`, each `import Widget from …` —
 * both key on `"Widget"`. The registry is a last-write-wins `Map`, so one
 * silently overwrites the other and the loser's island renders the winner's
 * component (its encrypted props even decrypt cleanly, since the AAD would match
 * too). Suffixing a hash of the resolved file path makes the identity unique per
 * component file. The result stays a valid `\w+` token so it flows through the
 * `__MOCHI_*__<id>__` placeholder regexes and `encodeURIComponent` unchanged.
 *
 * The hash derives only from the resolved path (base36 of a 64-bit hash), so it
 * is stable for a given file within a build and never leaks the absolute path
 * into client HTML. Named exports mix the export name into the hash so two
 * exports of one module (or two local aliases of different exports) stay
 * distinct; the default export hashes the bare path, keeping every existing
 * island identity (and prebuilt manifest) unchanged.
 */
function islandIdentity(name: string, resolvedPath: string, exportName: string): string {
  const identity = exportName === 'default' ? resolvedPath : `${resolvedPath}#${exportName}`;
  return `${name}_${Bun.hash(identity).toString(36)}`;
}

const SEED_FN = '__mochi_set_ctx__';
const SEED_IMPORT = `import { setContext as ${SEED_FN} } from 'svelte';`;
const IH_LOCAL = '__mochi_ih__';

function seedStatement(valueExpr: string): string {
  // Inline `Symbol.for` (same interned key as islands/isHydratable.ts) so the
  // injected code needs no framework import resolvable from the user's file.
  return `if (${valueExpr} === true) ${SEED_FN}(Symbol.for('mochi:hydratable'), true);`;
}

/** Statement kinds whose semantics don't differ between legacy and runes mode. */
const MODE_NEUTRAL_STATEMENTS = new Set(['ImportDeclaration', 'TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'EmptyStatement']);

const RUNE_ROOTS = new Set(['$state', '$derived', '$effect', '$bindable', '$inspect', '$host', '$props']);
const LEGACY_IDENTIFIERS = new Set(['$$props', '$$restProps', '$$slots']);

/**
 * Generic AST walk over any node graph carrying `type` fields. Svelte's modern
 * template AST hangs analysis `metadata` off nodes which can reference back
 * into the tree, so visited objects are tracked to survive cycles.
 */
function walkAnyNode(root: unknown, visit: (node: { type: string } & Record<string, unknown>) => void): void {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object' || seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.type === 'string') {
      visit(record as { type: string } & Record<string, unknown>);
    }
    for (const key of Object.keys(record)) {
      if (key === 'loc' || key === 'parent') {
        continue;
      }
      stack.push(record[key]);
    }
  }
}

interface PropsDeclaration {
  statement: Positioned;
  id: { type: string } & Record<string, unknown> & Positioned;
}

function findPropsDeclaration(instance: AST.Root['instance']): PropsDeclaration | null {
  if (!instance) {
    return null;
  }
  for (const node of instance.content.body) {
    if (node.type !== 'VariableDeclaration') {
      continue;
    }
    for (const declarator of node.declarations) {
      let init: Record<string, unknown> | null | undefined = declarator.init as Record<string, unknown> | null | undefined;
      while (init && (init.type === 'TSAsExpression' || init.type === 'TSSatisfiesExpression' || init.type === 'TSNonNullExpression' || init.type === 'ParenthesizedExpression')) {
        init = init.expression as Record<string, unknown>;
      }
      if (init && init.type === 'CallExpression' && (init.callee as { type: string; name?: string }).type === 'Identifier' && (init.callee as { name: string }).name === '$props') {
        return { statement: node as unknown as Positioned, id: declarator.id as unknown as PropsDeclaration['id'] };
      }
    }
  }
  return null;
}

/** `$$props`/`$$restProps`/`$$slots`, `$:` labels, or `export let` — legacy-mode certainty. */
function hasLegacyMarkers(ast: AST.Root): boolean {
  let found = false;
  const check = (node: { type: string } & Record<string, unknown>) => {
    if (node.type === 'Identifier' && LEGACY_IDENTIFIERS.has(node.name as string)) {
      found = true;
    } else if (node.type === 'LabeledStatement' && (node.label as { name?: string })?.name === '$') {
      found = true;
    } else if (
      node.type === 'ExportNamedDeclaration' &&
      (node.declaration as { type?: string; kind?: string })?.type === 'VariableDeclaration' &&
      (node.declaration as { kind: string }).kind !== 'const'
    ) {
      found = true;
    } else if (node.type === 'OnDirective' && Array.isArray(node.modifiers) && node.modifiers.length > 0) {
      // Event modifiers (`on:click|preventDefault`) only compile in legacy mode.
      found = true;
    } else if (node.type === 'LetDirective') {
      found = true;
    }
  };
  if (ast.instance) {
    walkAnyNode(ast.instance.content, check);
  }
  walkAnyNode(ast.fragment, check);
  return found;
}

function hasRuneCalls(instance: AST.Root['instance']): boolean {
  if (!instance) {
    return false;
  }
  let found = false;
  walkAnyNode(instance.content, (node) => {
    if (node.type !== 'CallExpression') {
      return;
    }
    const callee = node.callee as { type: string; name?: string; object?: { type: string; name?: string } };
    if (callee.type === 'Identifier' && RUNE_ROOTS.has(callee.name!)) {
      found = true;
    } else if (callee.type === 'MemberExpression' && callee.object?.type === 'Identifier' && RUNE_ROOTS.has(callee.object.name!)) {
      found = true;
    }
  });
  return found;
}

/**
 * Instance scripts made only of imports, type declarations, `const`s,
 * functions, and classes behave identically in legacy and runes mode, so
 * injecting a `$props()` read (which flips auto-detection to runes) cannot
 * change their semantics. Anything else — a top-level `let` (whose
 * reassignment is reactive only in legacy mode), instance `export`s
 * (accessor semantics differ), arbitrary statements — makes the flip unsafe.
 */
function isModeNeutralScript(instance: AST.Root['instance']): boolean {
  if (!instance) {
    return true;
  }
  for (const node of instance.content.body) {
    if (MODE_NEUTRAL_STATEMENTS.has(node.type)) {
      continue;
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'const') {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Inject a context seed into a component's instance script so an island root —
 * which receives the auto-injected `isHydratable` prop on every path (call-site
 * attribute, also-hydrate envelope, client bootstrap) — publishes it to its
 * whole subtree via Svelte context. Nested components read it back through
 * `isHydratable()` (islands/isHydratable.ts). Deliberately touches only the
 * script: zero template/DOM changes means zero hydration-marker risk, the
 * failure mode that sank the earlier wrapper-component attempt.
 *
 * Runs on every compiled component (server AND client — the `...rest`
 * extraction below must be symmetric or rest-spread DOM would differ across
 * hydration). Svelte allows a single `$props()` call per component, so when
 * the author already calls it we graft onto their declaration instead of
 * adding our own; when they don't, we only add one if the component's mode
 * (legacy vs runes) is provably unaffected — see the case analysis inline.
 * `runes` is the project-wide `compilerOptions.runes` override: when the mode
 * is forced there's nothing to auto-detect (and injecting the wrong flavor
 * would be a compile error we introduced).
 */
export function injectHydratableContextSeed(source: string, filePath: string, runesOption?: CompileOptions['runes']): string {
  if (source.includes(SEED_FN)) {
    return source;
  }
  // `compilerOptions.runes` may be a per-file predicate — resolve it the same
  // way the compiler will for this file.
  const runes = typeof runesOption === 'function' ? runesOption({ filename: filePath }) : runesOption;
  let ast: AST.Root;
  try {
    ast = parse(source, { modern: true });
  } catch {
    // Malformed source: let svelte.compile surface its own, better diagnostic.
    return source;
  }

  const s = new MagicString(source);
  const instance = ast.instance;
  const contentStart = instance ? (instance.content as unknown as Positioned).start : 0;
  const propsDecl = findPropsDeclaration(instance);

  if (propsDecl) {
    // Runes mode, author already calls $props(): read the prop off their
    // declaration.
    let valueExpr: string;
    if (propsDecl.id.type === 'Identifier') {
      valueExpr = `${propsDecl.id.name as string}.isHydratable`;
    } else if (propsDecl.id.type === 'ObjectPattern') {
      const properties = propsDecl.id.properties as Array<{ type: string } & Record<string, unknown> & Positioned>;
      const existing = properties.find(
        (p) =>
          p.type === 'Property' &&
          p.computed !== true &&
          (((p.key as { type: string; name?: string }).type === 'Identifier' && (p.key as { name: string }).name === 'isHydratable') ||
            ((p.key as { type: string; value?: unknown }).type === 'Literal' && (p.key as { value: unknown }).value === 'isHydratable')),
      );
      if (existing) {
        const value = existing.value as { type: string; name?: string; left?: { type: string; name?: string } };
        const local = value.type === 'Identifier' ? value.name : value.type === 'AssignmentPattern' && value.left?.type === 'Identifier' ? value.left.name : null;
        if (!local) {
          return source;
        }
        valueExpr = local;
      } else {
        // Insert at the pattern head: always valid (rest must stay last, and a
        // user trailing comma stays trailing). Extracting the prop here removes
        // it from any `...rest`, which stops the framework-internal prop
        // leaking through rest spreads — applied on both compile targets so
        // SSR and client agree.
        const hasProps = properties.length > 0;
        s.appendRight(propsDecl.id.start + 1, hasProps ? ` isHydratable: ${IH_LOCAL},` : ` isHydratable: ${IH_LOCAL} `);
        valueExpr = IH_LOCAL;
      }
    } else {
      return source;
    }
    s.appendRight(contentStart, `\n${SEED_IMPORT}`);
    s.appendRight(propsDecl.statement.end, `\n${seedStatement(valueExpr)}`);
    return s.toString();
  }

  if (runes === false || (runes === undefined && hasLegacyMarkers(ast))) {
    // Legacy mode: `$$props` is always in scope; `$props()` would be an error.
    if (instance) {
      s.appendRight(contentStart, `\n${SEED_IMPORT}\n${seedStatement('$$props.isHydratable')}`);
    } else {
      s.prepend(`<script>${SEED_IMPORT}\n${seedStatement('$$props.isHydratable')}</script>\n`);
    }
    return s.toString();
  }

  if (runes === true || hasRuneCalls(instance) || isModeNeutralScript(instance)) {
    const prologue = `${SEED_IMPORT}\nconst { isHydratable: ${IH_LOCAL} } = $props();\n${seedStatement(IH_LOCAL)}`;
    if (instance) {
      s.appendRight(contentStart, `\n${prologue}`);
    } else {
      s.prepend(`<script>${prologue}</script>\n`);
    }
    return s.toString();
  }

  // Mode-ambiguous script (e.g. a reactive top-level `let` with no runes and
  // no legacy markers): injecting $props() could silently flip it to runes
  // mode and kill legacy reactivity. Such an island root simply doesn't seed.
  return source;
}

interface MochiDirectives {
  server: AST.Attribute | null;
  hydrate: AST.Attribute | null;
  clientOnly: AST.Attribute | null;
}

/** Find `mochi:defer*`, `mochi:hydrate*`, and `mochi:clientOnly*` attributes on a component. */
function findMochiDirectives(attributes: Array<AST.Attribute | AST.SpreadAttribute | AST.Directive | AST.AttachTag>): MochiDirectives {
  let server: AST.Attribute | null = null;
  let hydrate: AST.Attribute | null = null;
  let clientOnly: AST.Attribute | null = null;
  for (const attr of attributes) {
    if (attr.type === 'Attribute') {
      if (attr.name === 'mochi:defer' || attr.name === 'mochi:defer:visible') {
        if (server) {
          throw new Error(`Cannot use both \`${server.name}\` and \`${attr.name}\` on the same component — pick one.`);
        }
        server = attr;
      } else if (attr.name === 'mochi:hydrate' || attr.name === 'mochi:hydrate:visible') {
        hydrate = attr;
      } else if (attr.name === 'mochi:clientOnly' || attr.name === 'mochi:clientOnly:visible') {
        clientOnly = attr;
      }
    }
  }
  if (clientOnly && (server || hydrate)) {
    throw new Error(`Cannot combine \`mochi:clientOnly\` with \`${(server ?? hydrate)!.name}\` — a client-only component is never server-rendered.`);
  }
  return { server, hydrate, clientOnly };
}

/**
 * Build a JS object expression from AST attributes, skipping mochi:* attrs.
 * `extraEntries` are framework-owned keys appended LAST so they win over
 * user-supplied spreads (last key wins in an object literal) — a `{...rest}`
 * carrying `islandId` must not override the transport id.
 */
function buildPropsFromAst(source: string, attributes: Array<AST.Attribute | AST.SpreadAttribute | AST.Directive | AST.AttachTag>, extraEntries: string[] = []): string {
  const entries: string[] = [];
  for (const attr of attributes) {
    if (attr.type === 'SpreadAttribute') {
      const expr = attr.expression as unknown as Positioned;
      entries.push(`...${source.slice(expr.start, expr.end)}`);
    } else if (attr.type === 'Attribute') {
      if (attr.name.startsWith('mochi:')) {
        continue;
      }
      if (attr.value === true) {
        entries.push(`${attr.name}: true`);
      } else if (!Array.isArray(attr.value)) {
        // ExpressionTag: value={expr} or {shorthand}
        const expr = attr.value.expression as unknown as Positioned;
        entries.push(`${attr.name}: ${source.slice(expr.start, expr.end)}`);
      } else {
        // String literal value like name="hello" → array of Text/ExpressionTag nodes.
        const parts = attr.value;
        const hasExpr = parts.some((v) => v.type !== 'Text');
        if (!hasExpr) {
          // Pure text — JSON.stringify escapes embedded quotes/backslashes so
          // `title='He said "hi"'` can't produce syntactically broken JS. Use the
          // decoded `data` (not the raw source `raw`) so HTML entities like `&amp;`
          // reach the component as `&`, matching the `{expr}` path.
          const text = parts.map((v) => (v.type === 'Text' ? v.data : '')).join('');
          entries.push(`${attr.name}: ${JSON.stringify(text)}`);
        } else {
          // Mixed text + expression (e.g. `title="Hello {name}"`) — emit a template
          // literal so expressions interpolate instead of being spliced in as
          // literal source text. Use the decoded `data` for the same reason as the
          // pure-text branch, and escape backslash/backtick/`${` in the text runs.
          const tpl = parts
            .map((v) => {
              if (v.type === 'Text') {
                // TODO: This is a bit jank and should be refactored
                return v.data.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
              }
              const expr = v.expression as unknown as Positioned;
              return '${' + source.slice(expr.start, expr.end) + '}';
            })
            .join('');
          // TODO: This is a bit jank and should be refactored
          entries.push(`${attr.name}: \`${tpl}\``);
        }
      }
    }
    // Skip Directive and AttachTag types — they're not props
  }
  entries.push(...extraEntries);
  return `{${entries.join(', ')}}`;
}
