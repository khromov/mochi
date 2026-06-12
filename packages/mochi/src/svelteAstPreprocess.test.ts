import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { preprocessHydratable } from './svelteAstPreprocess';

const SCRIPT = (imports: string) => `<script>\n${imports}\n</script>\n`;

describe('preprocessHydratable', () => {
  test('basic mochi:hydrate self-closing', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe('Foo');
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain('component-name="Foo"');
    expect(transformed).toContain('__MOCHI_COMPONENT_URL__Foo__');
    expect(transformed).toContain('<Foo isHydratable={true} />');
    expect(transformed).not.toContain('MochiIslandCtx');
    expect(transformed).not.toContain('mochi:hydrate');
    expect(transformed).toContain('__mochi_emit_props__');
  });

  test('mochi:hydrate:visible with options', () => {
    const source = `${SCRIPT('import Clock from "./Clock.svelte";')}<Clock mochi:hydrate:visible={{rootMargin: "100px"}} />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('hydrate-on="visible"');
    expect(transformed).toContain('__MOCHI_CSS_URL__Clock__');
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
    // Props expression should include the spread but not islandId
    expect(transformed).toMatch(/__mochi_emit_props__\(\{\.\.\.devalueProps\}, __mochi_iid\)/);
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
    expect(transformed).toContain('<Wrapper isHydratable={true}><span>child content</span></Wrapper>');
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
    expect(hydratables.map((h) => h.name)).toEqual(['Foo', 'Bar']);
  });

  test('component inside {#each} block', () => {
    const source = `${SCRIPT('import Item from "./Item.svelte";')}{#each items as item}<Item mochi:hydrate />{/each}`;
    const { hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(1);
    expect(hydratables[0]!.name).toBe('Item');
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
  });

  test('component without matching import is skipped', () => {
    const source = `${SCRIPT('')}<Unknown mochi:hydrate />`;
    const { transformed, hydratables } = preprocessHydratable(source, '/test/File.svelte');

    expect(hydratables).toHaveLength(0);
    expect(transformed).toBe(source);
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
    expect(serverIslands[0]!.name).toBe('Greeting');
    expect(hydratables).toHaveLength(0);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('component-name="Greeting"');
    expect(transformed).toContain('__mochi_sign_props__');
    expect(transformed).toContain('__mochi_stringify__');
    expect(transformed).toContain('name: "World"');
    expect(transformed).toContain('__MOCHI_SERVER_CSS_URL__Greeting__');
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
    expect(transformed).toContain('__MOCHI_COMPONENT_URL__Widget__');
    expect(transformed).toContain('__mochi_sign_props__');
  });

  test('mochi:defer + mochi:hydrate:visible combination', () => {
    const source = `${SCRIPT('import Lazy from "./Lazy.svelte";')}<Lazy mochi:defer mochi:hydrate:visible />`;
    const { transformed, hydratables, serverIslands } = preprocessHydratable(source, '/test/File.svelte');

    expect(serverIslands).toHaveLength(1);
    expect(hydratables).toHaveLength(1);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('also-hydrate="visible"');
    expect(transformed).toContain('__MOCHI_COMPONENT_URL__Lazy__');
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

  test('mochi:defer injects signProps import', () => {
    const source = `<script lang="ts">\nimport Srv from "./Srv.svelte";\n</script>\n<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('import { signProps as __mochi_sign_props__ } from "mochi-server-island-runtime"');
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
    expect(serverIslands[0]!.name).toBe('Greeting');
    expect(hydratables).toHaveLength(0);
    expect(transformed).toContain('<mochi-server-island');
    expect(transformed).toContain('defer-on="visible"');
    expect(transformed).toContain('component-name="Greeting"');
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
    expect(transformed).toContain('__MOCHI_COMPONENT_URL__Widget__');
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

  test('islandId is passed as prop to inner component', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate count={1} />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Both wrapper and inner component use the same __mochi_iid variable
    expect(transformed).toContain('island-id={__mochi_iid}');
    expect(transformed).toContain('<Foo count={1} isHydratable={true} />');

    // No MochiIslandContext wrapper
    expect(transformed).not.toContain('MochiIslandCtx');
  });

  test('island-id is unique per island instance', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";\nimport Bar from "./Bar.svelte";')}<Foo mochi:hydrate />\n<Foo mochi:hydrate />\n<Bar mochi:hydrate />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // Each island site gets a unique nanoid base in its {@const} declaration
    const bases = [...transformed.matchAll(/@const __mochi_iid = `(mochi-[^-]+-)/g)].map((m) => m[1]);
    expect(bases).toHaveLength(3);
    expect(new Set(bases).size).toBe(3);
  });

  test('island-id is present on server islands', () => {
    const source = `${SCRIPT('import Srv from "./Srv.svelte";')}<Srv mochi:defer />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    expect(transformed).toContain('island-id={__mochi_iid}');
  });

  test('hydrate island serialized props do not contain islandId', () => {
    const source = `${SCRIPT('import Foo from "./Foo.svelte";')}<Foo mochi:hydrate name="test" />`;
    const { transformed } = preprocessHydratable(source, '/test/File.svelte');

    // islandId should be on wrapper attribute and inner component prop
    expect(transformed).toContain('island-id={__mochi_iid}');

    // But NOT inside the serialized props expression
    const propsMatch = transformed.match(/__mochi_emit_props__\((\{[^}]+\}), __mochi_iid\)/);
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
    expect(hydratables[0]!.name).toBe('Readme');
    expect(hydratables[0]!.resolvedPath).toBe(path.resolve('/test', 'Readme.md'));
    expect(transformed).toContain('<mochi-hydratable-island');
    expect(transformed).toContain('component-name="Readme"');
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
    expect(transformed).toContain('<Foo name="test" count={42} isHydratable={true} />');
    expect(transformed).toContain('<svelte:boundary>');
  });
});
