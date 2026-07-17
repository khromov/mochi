import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { preprocessHydratable } from './svelteAstPreprocess';

const SCRIPT = (imports: string) => `<script>\n${imports}\n</script>\n`;

// Mirror of the internal `islandIdentity()`: an island's `component-name`, its
// registry keys, and its `__MOCHI_*__<id>__` placeholders are keyed by
// `<localName>_<hash of resolved path>`, not the bare import name — so two
// same-named components in different files can't collide to one registry entry.
// Tests use fixture files under `/test`, matching the `filePath` passed below.
const idFor = (name: string, importPath: string) => `${name}_${Bun.hash(path.resolve('/test', importPath)).toString(36)}`;
// Named-export islands mix the export name into the identity hash (default-export
// identities stay path-only, so `idFor` remains the legacy/manifest-stable form).
const idForNamed = (name: string, importPath: string, exportName: string) => `${name}_${Bun.hash(`${path.resolve('/test', importPath)}#${exportName}`).toString(36)}`;

describe('preprocessHydratable', () => {
  test('basic mochi:hydrate self-closing', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe(idFor('Foo', './Foo.svelte'));
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain(`component-name="${idFor('Foo', './Foo.svelte')}"`);
    expect(transformed).toContain(`__MOCHI_COMPONENT_URL__${idFor('Foo', './Foo.svelte')}__`);
    expect(transformed).toContain('<Foo __mochi_hydratable={true} />');
    expect(transformed).not.toContain('MochiIslandCtx');
    expect(transformed).not.toContain('mochi:hydrate');
    expect(transformed).toContain('__mochi_emit_props__');
  });

  test('mochi:hydrate:visible with options', () => {
    const source = `${SCRIPT('import Clock from "./Clock.svelte";')}<Clock mochi:hydrate:visible={{rootMargin: "100px"}} />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('hydrate-on="visible"');
    expect(transformed).toContain(`__MOCHI_CSS_URL__${idFor('Clock', './Clock.svelte')}__`);
    expect(transformed).toContain('hydrate-options={JSON.stringify({rootMargin: "100px"})}');
    expect(transformed).not.toContain('mochi:hydrate:visible');
  });

  test('mochi:hydrate:visible without options', () => {
    const source = `${SCRIPT('import Lazy from "./Lazy.svelte";')}<Lazy mochi:hydrate:visible index={1} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('hydrate-on="visible"');
    expect(transformed).not.toContain('hydrate-options');
    expect(transformed).toContain('index={1}');
  });

  test('spread props', () => {
    const source = `${SCRIPT('import Demo from "./Demo.svelte";')}<Demo {...devalueProps} mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('...devalueProps');
    expect(transformed).toContain('{...devalueProps}');
    // Props expression should include the spread; hydratable islands no longer
    // carry an id, so emit_props takes a single argument.
    expect(transformed).toMatch(/__mochi_emit_props__\(\{\.\.\.devalueProps\}\)/);
  });

  test('shorthand props', () => {
    const source = `${SCRIPT('import Stats from "./Stats.svelte";')}<Stats mochi:hydrate:visible={{rootMargin: "100px"}} {stats} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('{stats}');
    expect(transformed).toContain('stats: stats');
  });

  test('string literal props', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp theme="dark" mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('theme="dark"');
    expect(transformed).toContain('theme: "dark"');
  });

  test('string literal props with HTML entities are decoded', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp label="Tom &amp; Jerry" mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // The serialized prop payload must carry the decoded `&`, matching the `{expr}`
    // path — pre-fix this was the raw source `label: "Tom &amp; Jerry"`. (The SSR
    // component invocation keeps the raw `&amp;`; Svelte decodes that at compile time.)
    expect(transformed).toContain('label: "Tom & Jerry"');
    expect(transformed).not.toContain('label: "Tom &amp; Jerry"');
  });

  test('nested braces in props (fixed over regex)', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp data={{ a: { b: 1 } }} mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('data: { a: { b: 1 } }');
  });

  test('< in expression (fixed over regex)', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp count={a < b ? 1 : 2} mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('count: a < b ? 1 : 2');
  });

  test('arrow function in props (fixed over regex)', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp callback={() => { doSomething(); }} mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('callback: () => { doSomething(); }');
  });

  test('non-self-closing component (fixed over regex)', () => {
    const source = `${SCRIPT('import Wrapper from "./Wrapper.svelte";')}<Wrapper mochi:hydrate><span>child content</span></Wrapper>`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain('<Wrapper __mochi_hydratable={true}><span>child content</span></Wrapper>');
  });

  test('duplicate component instances', () => {
    const source = `${SCRIPT('import Counter from "./Counter.svelte";')}<Counter mochi:hydrate />\n<Counter mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    // Only one entry in hydratables (deduplicated)
    expect(hydratables).toHaveLength(1);
    // But both instances should be wrapped
    const matches = transformed.match(/<mochi-hydratable-island/g);
    expect(matches).toHaveLength(2);
  });

  test('multiple different components', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";\nimport Bar from "./Bar.svelte";')}<Foo mochi:hydrate />\n<Bar mochi:hydrate:visible />`;
    const { hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(2);
    expect(hydratables.map((h) => h.name)).toEqual([idFor('Foo', './Foo.svelte'), idFor('Bar', './Bar.svelte')]);
  });

  test('component inside {#each} block', () => {
    const source = `${SCRIPT('import Item from "./Item.svelte";')}{#each items as item}<Item mochi:hydrate />{/each}`;
    const { hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe(idFor('Item', './Item.svelte'));
  });

  test('component inside {#if} block', () => {
    const source = `${SCRIPT('import Cond from "./Cond.svelte";')}{#if show}<Cond mochi:hydrate />{/if}`;
    const { hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
  });

  test('no mochi directives returns unchanged source', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(transformed).toBe(source);
  });

  test('fast-path skips Svelte parse for sources without mochi markers', () => {
    // Syntactically invalid Svelte that would crash `parse()` — if the fast-path
    // didn't fire, this would throw. With the early-exit it returns the source
    // unchanged because no `mochi:hydrate` / `mochi:defer` substring is present.
    const source = 'this is not valid svelte {{{{ <<<<';
    const result = preprocessHydratable(source, '/test/Garbage.svelte');
    expect(result.transformed).toBe(source);
    expect(result.hydratables).toHaveLength(0);
    expect(result.serverIslands).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('component without matching import reports an unresolved-island error', () => {
    const source = `${SCRIPT('')}<Unknown mochi:hydrate />`;
    const { transformed, hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(transformed).toBe(source);
    expect(errors).toEqual([{ component: 'Unknown', directive: 'mochi:hydrate', filePath: '/test/File.svelte', importSource: null }]);
  });

  test('directive on a bare third-party package import errors with the specifier', () => {
    const source = `${SCRIPT("import { Widget } from 'some-ui-lib';")}<Widget mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(errors).toEqual([{ component: 'Widget', directive: 'mochi:hydrate', filePath: '/test/File.svelte', importSource: 'some-ui-lib' }]);
  });

  test('a mochi-framework/components named import resolves to its on-disk .svelte island', () => {
    const source = `${SCRIPT("import { MochiCaptcha } from 'mochi-framework/components';")}<MochiCaptcha mochi:hydrate />`;
    const { transformed, hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.exportName).toBe('default');
    expect(hydratables[0]!.resolvedPath.endsWith(path.join('captcha', 'MochiCaptcha.svelte'))).toBe(true);
    expect(transformed).toContain('<mochi-hydratable-island');
  });

  test('an aliased mochi-framework/components import keeps the local name but resolves the export', () => {
    const source = `${SCRIPT("import { MochiCaptcha as Cap } from 'mochi-framework/components';")}<Cap mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.displayName).toBe('Cap');
    expect(hydratables[0]!.exportName).toBe('default');
    expect(hydratables[0]!.resolvedPath.endsWith(path.join('captcha', 'MochiCaptcha.svelte'))).toBe(true);
  });

  test('an unknown mochi-framework/components export falls through to an unresolved-island error', () => {
    const source = `${SCRIPT("import { NotAComponent } from 'mochi-framework/components';")}<NotAComponent mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(errors).toEqual([{ component: 'NotAComponent', directive: 'mochi:hydrate', filePath: '/test/File.svelte', importSource: 'mochi-framework/components' }]);
  });

  test('directive on a relative non-svelte import errors with the specifier', () => {
    const source = `${SCRIPT("import Widget from './Widget.js';")}<Widget mochi:defer />`;
    const { serverIslands, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(0);
    expect(errors).toEqual([{ component: 'Widget', directive: 'mochi:defer', filePath: '/test/File.svelte', importSource: './Widget.js' }]);
  });

  test('mochi:clientOnly shares the unresolved-island gate', () => {
    const source = `${SCRIPT("import { Thing } from 'some-pkg';")}<Thing mochi:clientOnly />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(errors[0]).toEqual({ component: 'Thing', directive: 'mochi:clientOnly', filePath: '/test/File.svelte', importSource: 'some-pkg' });
  });

  test('named import from a relative .svelte path is an island', () => {
    const source = `${SCRIPT("import { Widget } from './Barrel.svelte';")}<Widget mochi:hydrate />`;
    const { transformed, hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.exportName).toBe('Widget');
    expect(hydratables[0]!.name).toBe(idForNamed('Widget', './Barrel.svelte', 'Widget'));
    expect(transformed).toContain('<mochi-hydratable-island');
  });

  test('aliased named import keeps the local displayName and the real exportName', () => {
    const source = `${SCRIPT("import { Widget as W } from './Barrel.svelte';")}<W mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.displayName).toBe('W');
    expect(hydratables[0]!.exportName).toBe('Widget');
    expect(hydratables[0]!.name).toBe(idForNamed('W', './Barrel.svelte', 'Widget'));
  });

  test('mixed default + named import hydrates via the default with legacy identity', () => {
    const source = `${SCRIPT("import Widget, { RESET } from './Widget.svelte';")}<Widget mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.exportName).toBe('default');
    // Hash-stability: default imports keep the pre-exportName identity.
    expect(hydratables[0]!.name).toBe(idFor('Widget', './Widget.svelte'));
  });

  test('two named exports from one file are distinct islands', () => {
    const source = `${SCRIPT("import { A, B } from './Barrel.svelte';")}<A mochi:hydrate />\n<B mochi:hydrate />`;
    const { hydratables, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(hydratables).toHaveLength(2);
    expect(new Set(hydratables.map((h) => h.name)).size).toBe(2);
  });

  test('named import with mochi:defer records the exportName on the server island', () => {
    const source = `${SCRIPT("import { Widget } from './Barrel.svelte';")}<Widget mochi:defer />`;
    const { serverIslands, errors } = preprocessHydratable(source, '/test/File.svelte');

    expect(errors).toHaveLength(0);
    expect(serverIslands).toHaveLength(1);
    expect(serverIslands[0]!.exportName).toBe('Widget');
    expect(serverIslands[0]!.name).toBe(idForNamed('Widget', './Barrel.svelte', 'Widget'));
  });

  test('emitIslandProps import is injected into script for hydratable islands', () => {
    const source = `<script lang="ts">\nimport Foo from "./Foo.svelte";\n</script>\n<Foo mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('import { emitIslandProps as __mochi_emit_props__ } from "mochi-framework"');
    // Should be inside the script tag
    const scriptMatch = transformed.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    expect(scriptMatch).not.toBeNull();
    expect(scriptMatch![1]).toContain('__mochi_emit_props__');
    // Hydratable islands no longer pull in `stringify` — that import is reserved
    // for the server-island branch (which signs its props).
    expect(transformed).not.toContain('__mochi_stringify__');
  });

  test('boolean prop', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp disabled mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('disabled: true');
    expect(transformed).toContain('disabled');
  });

  test('mixed prop types in single component', () => {
    const source = `${SCRIPT('import Comp from "./Comp.svelte";')}<Comp name="test" count={42} {active} {...rest} mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('name: "test"');
    expect(transformed).toContain('count: 42');
    expect(transformed).toContain('active: active');
    expect(transformed).toContain('...rest');
  });

  // --- Server island tests ---

  test('basic mochi:defer self-closing', () => {
    const source = `${SCRIPT('import Greeting from "./Greeting.svelte";')}<Greeting mochi:defer name="World" />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(serverIslands[0]!.name).toBe(idFor('Greeting', './Greeting.svelte'));
    expect(hydratables).toHaveLength(0);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain(`component-name="${idFor('Greeting', './Greeting.svelte')}"`);
    expect(transformed).toContain('__mochi_encrypt_props__');
    expect(transformed).toContain('__mochi_stringify__');
    expect(transformed).toContain('name: "World"');
    expect(transformed).toContain(`__MOCHI_SERVER_CSS_URL__${idFor('Greeting', './Greeting.svelte')}__`);
    expect(transformed).not.toContain('mochi:defer');
  });

  test('mochi:defer with children (fallback)', () => {
    const source = `${SCRIPT('import ServerComp from "./ServerComp.svelte";')}<ServerComp mochi:defer name="test"><div class="skeleton">Loading...</div></ServerComp>`;
    const { transformed, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('<div class="skeleton">Loading...</div>');
    expect(transformed).toContain('</mochi-server-island>');
  });

  test('mochi:defer + mochi:hydrate combination', () => {
    const source = `${SCRIPT('import Widget from "./Widget.svelte";')}<Widget mochi:defer mochi:hydrate count={5} />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('also-hydrate="eager"');
    expect(transformed).toContain(`__MOCHI_COMPONENT_URL__${idFor('Widget', './Widget.svelte')}__`);
    expect(transformed).toContain('__mochi_encrypt_props__');
  });

  test('mochi:defer + mochi:hydrate:visible combination', () => {
    const source = `${SCRIPT('import Lazy from "./Lazy.svelte";')}<Lazy mochi:defer mochi:hydrate:visible />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('also-hydrate="visible"');
    expect(transformed).toContain(`__MOCHI_COMPONENT_URL__${idFor('Lazy', './Lazy.svelte')}__`);
  });

  test('mochi:defer with options passes server-options attribute', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer={{retries: 10}} name="test" />`;
    const { transformed, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('server-options={JSON.stringify({retries: 10})}');
  });

  test('mochi:defer without options omits server-options attribute', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer name="test" />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).not.toContain('server-options');
  });

  test('mochi:defer injects encryptProps import', () => {
    const source = `<script lang="ts">\nimport Srv from "./Srv.svelte";\n</script>\n<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('import { encryptProps as __mochi_encrypt_props__ } from "mochi-server-island-runtime"');
    expect(transformed).toContain('import { stringify as __mochi_stringify__ } from "mochi-framework"');
  });

  test('duplicate server island instances', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />\n<Srv mochi:defer />`;
    const { transformed, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    const matches = transformed.match(/<mochi-server-island/g);
    expect(matches).toHaveLength(2);
  });

  // --- mochi:defer:visible tests ---

  test('basic mochi:defer:visible self-closing', () => {
    const source = `${SCRIPT('import Greeting from "./Greeting.svelte";')}<Greeting mochi:defer:visible name="World" />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(serverIslands[0]!.name).toBe(idFor('Greeting', './Greeting.svelte'));
    expect(hydratables).toHaveLength(0);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain(`component-name="${idFor('Greeting', './Greeting.svelte')}"`);
    expect(transformed).toContain('name: "World"');
    expect(transformed).not.toContain('mochi:defer:visible');
  });

  test('mochi:defer:visible with rootMargin option', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer:visible={{rootMargin: "200px"}} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain('server-options={JSON.stringify({rootMargin: "200px"})}');
  });

  test('mochi:defer:visible with combined options', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer:visible={{rootMargin: "100px", retries: 10}} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain('server-options={JSON.stringify({rootMargin: "100px", retries: 10})}');
  });

  test('mochi:defer:visible + mochi:hydrate combination', () => {
    const source = `${SCRIPT('import Widget from "./Widget.svelte";')}<Widget mochi:defer:visible mochi:hydrate count={5} />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain('also-hydrate="eager"');
    expect(transformed).toContain(`__MOCHI_COMPONENT_URL__${idFor('Widget', './Widget.svelte')}__`);
  });

  test('mochi:defer:visible + mochi:hydrate:visible combination', () => {
    const source = `${SCRIPT('import Lazy from "./Lazy.svelte";')}<Lazy mochi:defer:visible mochi:hydrate:visible />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain('also-hydrate="visible"');
  });

  test('both mochi:defer and mochi:defer:visible on one component throws', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer mochi:defer:visible />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow(/mochi:defer.*mochi:defer:visible/);
  });

  test('plain mochi:defer does not emit defer-on', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).not.toContain('defer-on');
  });

  test('islandId is NOT passed as prop to inner component', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate count={1} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Hydratable islands carry no id at all — the inner component only gets
    // the internal hydratable transport prop, and components needing an id use Svelte's native
    // $props.id() (recovered from its own comment markers on hydration).
    expect(transformed).not.toContain('island-id');
    expect(transformed).toContain('<Foo count={1} __mochi_hydratable={true} />');
    expect(transformed).not.toContain('islandId={__mochi_iid}');

    // No MochiIslandContext wrapper
    expect(transformed).not.toContain('MochiIslandCtx');
  });

  test('island id derives from $props.id() plus a per-instance counter (server islands)', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";\nimport Bar from "./Bar.svelte";')}<Foo mochi:defer />\n<Foo mochi:defer />\n<Bar mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Every server-island site emits the same deterministic {@const};
    // uniqueness is runtime — $props.id() per parent instance, counter per
    // island within it.
    const decls = transformed.match(/\{@const __mochi_iid = `\$\{__mochi_pid__\}-\$\{__mochi_uid__\+\+\}`\}/g);
    expect(decls).toHaveLength(3);
  });

  test('no id machinery is injected for hydrate-only files', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Hydratable islands no longer need the `__mochi_iid` transport id — the
    // rune, counter and `{@const}` are reserved for server islands. (The
    // `{#if true}` wrapper stays — it scopes each island's `failed` snippet.)
    expect(transformed).not.toContain('__mochi_pid__');
    expect(transformed).not.toContain('__mochi_uid__');
    expect(transformed).not.toContain('__mochi_iid');
    expect(transformed).not.toContain('{@const');
  });

  test('$props.id() declaration is injected for server islands', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('const __mochi_pid__ = $props.id();');
  });

  test('existing $props.id() declaration is reused instead of injecting a second one', () => {
    // Svelte allows only one $props.id() per component (props_duplicate)
    const source = `${SCRIPT('import Srv from "./Srv.svelte";\nconst myId = $props.id();')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).not.toContain('__mochi_pid__');
    expect(transformed).toContain('{@const __mochi_iid = `${myId}-${__mochi_uid__++}`}');
  });

  test('server islands carry no island-id attribute (id rides the signed envelope)', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // The composed id reaches the endpoint inside the signed props envelope,
    // not as a redundant wrapper attribute.
    expect(transformed).not.toContain('island-id');
    expect(transformed).toContain('islandId: __mochi_iid');
    expect(transformed).toContain('__mochi_stringify__');
  });

  test('literal islandId prop on a server island is rejected', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer islandId="mine" />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow(/reserved framework name/);
  });

  test('framework islandId wins over a user spread on server islands', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";\nconst rest = { islandId: "mine" };')}<Srv mochi:defer {...rest} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Framework entries come last in the object literal, so the spread cannot
    // override the transport id (last key wins).
    expect(transformed).toContain('{...rest, islandId: __mochi_iid}');
  });

  test('literal islandId prop on a plain hydrate island is rejected too', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate islandId="mine" />`;
    // `islandId` is reserved on every island, not just `mochi:defer`, so a
    // component can move between directives without the prop changing meaning.
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow(/reserved framework name/);
  });

  test('hydrate island serialized props do not contain islandId', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate name="test" />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Hydratable islands carry no id, so emit_props takes only the props and
    // the serialized payload never contains islandId.
    const propsMatch = transformed.match(/__mochi_emit_props__\((\{[^}]+\})\)/);
    expect(propsMatch).not.toBeNull();
    expect(propsMatch![1]).not.toContain('islandId');
    expect(propsMatch![1]).toContain('name: "test"');
  });

  test('server island serialized props still contain islandId', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer name="hello" />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    const stringifyMatch = transformed.match(/__mochi_stringify__\((\{[^)]+\})\)/);
    expect(stringifyMatch).not.toBeNull();
    expect(stringifyMatch![1]).toContain('islandId');
  });

  test('serverIslands not returned for hydrate-only components', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;
    const { serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(0);
  });

  test('.md import resolves as a hydratable component', () => {
    const source = `${SCRIPT('import Readme from "./Readme.md";')}<Readme mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe(idFor('Readme', './Readme.md'));
    expect(hydratables[0]!.resolvedPath).toBe(path.resolve('/test', 'Readme.md'));
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain(`component-name="${idFor('Readme', './Readme.md')}"`);
  });

  test('.svx import resolves as a hydratable component', () => {
    const source = `${SCRIPT('import Post from "./Post.svx";')}<Post mochi:hydrate:visible />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.resolvedPath).toBe(path.resolve('/test', 'Post.svx'));
    expect(transformed).toContain('hydrate-on="visible"');
  });

  test('.md import resolves as a server island', () => {
    const source = `${SCRIPT('import Readme from "./Readme.md";')}<Readme mochi:defer />`;
    const { transformed, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(serverIslands[0]!.resolvedPath).toBe(path.resolve('/test', 'Readme.md'));
    expect(transformed).toContain('<mochi-server-island');
  });

  test('unrecognized extension is ignored (no hydration)', () => {
    const source = `${SCRIPT('import Data from "./Data.json";')}<Data mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(transformed).not.toContain('<mochi-hydratable-island');
  });

  // --- Error boundary tests ---

  test('mochi:hydrate wraps inner component in <svelte:boundary>', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // boundary wraps the custom-element from outside, not the inner tag
    expect(transformed).toContain('<svelte:boundary>');
    expect(transformed).toContain('</svelte:boundary>');
    expect(transformed).toContain('{#snippet failed(error)}');
    expect(transformed).toContain('<mochi-island-failure');
    expect(transformed).toContain('data-component="Foo"');

    // The OUTER boundary opens BEFORE <mochi-hydratable-island ...> and closes
    // AFTER it. An INNER boundary (no `failed` snippet) is also nested inside
    // the wrapper to force Svelte to emit a `<!--[-->` HYDRATION_START anchor
    // at depth ≥ 1 — without it, Svelte's `hydrate()` can't find a marker
    // inside the wrapper and silently falls back to `mount()`.
    const islandOpen = transformed.indexOf('<mochi-hydratable-island');
    const islandClose = transformed.indexOf('</mochi-hydratable-island>');
    const outerBoundaryOpen = transformed.indexOf('<svelte:boundary>');
    const outerBoundaryClose = transformed.lastIndexOf('</svelte:boundary>');
    expect(outerBoundaryOpen).toBeLessThan(islandOpen);
    expect(islandOpen).toBeLessThan(islandClose);
    expect(islandClose).toBeLessThan(outerBoundaryClose);

    // Inner boundary: opens after the wrapper opens, closes before it closes.
    const innerBoundaryOpen = transformed.indexOf('<svelte:boundary>', islandOpen);
    const innerBoundaryClose = transformed.indexOf('</svelte:boundary>');
    expect(innerBoundaryOpen).toBeGreaterThan(islandOpen);
    expect(innerBoundaryClose).toBeLessThan(islandClose);
  });

  test('mochi:hydrate:visible also wraps in <svelte:boundary>', () => {
    const source = `${SCRIPT('import Lazy from "./Lazy.svelte";')}<Lazy mochi:hydrate:visible />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('<svelte:boundary>');
    expect(transformed).toContain('data-component="Lazy"');
  });

  test('mochi:defer alone does NOT add a boundary', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Server islands are rendered standalone at the /island/:name endpoint —
    // boundary handling there is via transformError + endpoint try/catch.
    expect(transformed).not.toContain('<svelte:boundary>');
    expect(transformed).not.toContain('mochi-island-failure');
  });

  test('mochi:defer + mochi:hydrate combo does NOT add a boundary in the parent', () => {
    const source = `${SCRIPT('import Widget from "./Widget.svelte";')}<Widget mochi:defer mochi:hydrate count={5} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // The combo path renders <mochi-server-island> in the parent — no boundary
    // here. The eventual hydratable wrap happens at the endpoint with the
    // already-rendered island body, where the boundary would lose its
    // semantic value (the throw already happened or didn't).
    expect(transformed).not.toContain('<svelte:boundary>');
  });

  test('boundary preserves inner tag and props', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate name="test" count={42} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // The inner tag is unchanged — boundary just wraps it
    expect(transformed).toContain('<Foo name="test" count={42} __mochi_hydratable={true} />');
    expect(transformed).toContain('<svelte:boundary>');
  });
});

describe('mochi:clientOnly', () => {
  test('basic self-closing', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe(idFor('Foo', './Foo.svelte'));
    expect(serverIslands).toHaveLength(0);
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain('client-only');
    expect(transformed).toContain(`component-name="${idFor('Foo', './Foo.svelte')}"`);
    expect(transformed).toContain(`__MOCHI_COMPONENT_URL__${idFor('Foo', './Foo.svelte')}__`);
    // The component invocation is never emitted server-side
    expect(transformed).not.toContain('<Foo');
    expect(transformed).not.toContain('mochi:clientOnly');
    expect(transformed).not.toContain('<svelte:boundary>');
    expect(transformed).not.toContain('hydrate-on');
    expect(transformed).not.toContain('__MOCHI_CSS_URL__');
    // No props → no props-ref (empty-props optimization)
    expect(transformed).not.toContain('props-ref');
  });

  test('props are serialized without islandId/isHydratable', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly count={n} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('props-ref={__mochi_emit_props__({count: n})}');
    expect(transformed).not.toContain('islandId:');
    expect(transformed).not.toContain('isHydratable');
    // No id is minted for client-only islands; Svelte mints `$props.id()` at mount.
    expect(transformed).not.toContain('island-id');
    expect(transformed).not.toContain('__mochi_iid');
  });

  test('fallback children render inside the wrapper', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly><span>loading…</span></Foo>`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toMatch(/<mochi-hydratable-island [^>]*><span>loading…<\/span><\/mochi-hydratable-island>/);
    expect(transformed).not.toContain('<Foo');
    // No props on the invocation → no props-ref (empty-props optimization)
    expect(transformed).not.toContain('props-ref');
  });

  test('a boolean literal value with no children means no fallback', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly={true} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toMatch(/<mochi-hydratable-island [^>]*><\/mochi-hydratable-island>/);
  });

  test('whitespace-only children are tolerated', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly>\n</Foo>`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('<mochi-hydratable-island');
  });

  test('combining with mochi:hydrate throws', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly mochi:hydrate />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow('Cannot combine `mochi:clientOnly` with `mochi:hydrate`');
  });

  test('combining with mochi:defer throws', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:defer mochi:clientOnly />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow('Cannot combine `mochi:clientOnly` with `mochi:defer`');
  });

  test('duplicate instances dedupe in hydratables but both get wrappers', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly />\n<Foo mochi:clientOnly />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(transformed.match(/<mochi-hydratable-island/g)).toHaveLength(2);
  });

  test('mixed mochi:hydrate and mochi:clientOnly for the same component', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />\n<Foo mochi:clientOnly />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    // Only the hydrate instance keeps an inner component invocation
    expect(transformed.match(/<Foo /g)).toHaveLength(1);
    expect(transformed.match(/<mochi-hydratable-island/g)).toHaveLength(2);
    expect(transformed.match(/client-only/g)).toHaveLength(1);
  });

  test('imports are injected when only clientOnly directives exist', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly value={1} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('import { emitIslandProps as __mochi_emit_props__ } from "mochi-framework";');
    // Client-only islands mint no id, so the `__mochi_uid__` counter isn't needed.
    expect(transformed).not.toContain('let __mochi_uid__ = 0;');
  });
});

describe('mochi:clientOnly:visible', () => {
  test('basic self-closing emits client-only + visible attributes', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly:visible />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(serverIslands).toHaveLength(0);
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain('client-only');
    expect(transformed).toContain('hydrate-on="visible"');
    expect(transformed).toContain(`__MOCHI_CSS_URL__${idFor('Foo', './Foo.svelte')}__`);
    // Still client-only: never server-rendered, no boundary, no options unless given
    expect(transformed).not.toContain('<Foo');
    expect(transformed).not.toContain('<svelte:boundary>');
    expect(transformed).not.toContain('hydrate-options');
    expect(transformed).not.toContain('mochi:clientOnly');
  });

  test('with rootMargin option emits hydrate-options', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly:visible={{rootMargin: "100px"}} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('hydrate-on="visible"');
    expect(transformed).toContain('hydrate-options={JSON.stringify({rootMargin: "100px"})}');
    expect(transformed).not.toContain('mochi:clientOnly:visible');
  });

  test('fallback children render inside the wrapper', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly:visible><span>loading…</span></Foo>`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toMatch(/<mochi-hydratable-island [^>]*hydrate-on="visible"[^>]*><span>loading…<\/span><\/mochi-hydratable-island>/);
    expect(transformed).not.toContain('<Foo');
  });

  test('combining with mochi:hydrate throws', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:clientOnly:visible mochi:hydrate />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow('Cannot combine `mochi:clientOnly` with `mochi:hydrate`');
  });

  test('combining with mochi:defer throws', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:defer mochi:clientOnly:visible />`;
    expect(() => preprocessHydratable(source, '/test/File.svelte')).toThrow('Cannot combine `mochi:clientOnly` with `mochi:defer`');
  });
});
