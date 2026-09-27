<script lang="ts">
  // Every case here is a way Svelte 5 tracks a dependency through something that *looks* removable to a minifier:
  // a bare property read, a getter, a proxied field. If oxc drops or reorders any of them the counters below stop
  // advancing, which the harness reads back out of the DOM.
  class Model {
    count = $state(0);
    label = $state('start');
    #hidden = $state(1);
    get hidden() {
      return this.#hidden;
    }
    bumpHidden() {
      this.#hidden += 1;
    }
  }

  const model = new Model();
  const obj = $state({ prop: 0, nested: { deep: 0 } });

  // Deliberately NOT `$state`: a reactive write inside a getter a `$derived` reads is a Svelte error, not a minifier
  // question. A plain counter still proves the getter body ran exactly as often in both builds.
  let getterReadCount = 0;
  const source = {
    get tracked() {
      getterReadCount += 1;
      return obj.prop;
    },
  };

  // Each effect counts runs in a plain variable and only ever *writes* the $state mirror it renders through: a
  // read-modify-write of a $state inside its own effect is a self-dependency, which is a Svelte loop rather than a
  // minifier question. The leading bare property read is the dependency under test.
  let bareReadCount = 0;
  let bareReadEffects = $state(0);
  $effect(() => {
    obj.prop;
    bareReadCount += 1;
    bareReadEffects = bareReadCount;
  });

  let nestedCount = 0;
  let nestedEffects = $state(0);
  $effect(() => {
    obj.nested.deep;
    nestedCount += 1;
    nestedEffects = nestedCount;
  });

  let classFieldCount = 0;
  let classFieldEffects = $state(0);
  $effect(() => {
    model.count;
    classFieldCount += 1;
    classFieldEffects = classFieldCount;
  });

  let privateGetterCount = 0;
  let privateGetterEffects = $state(0);
  $effect(() => {
    model.hidden;
    privateGetterCount += 1;
    privateGetterEffects = privateGetterCount;
  });

  const derivedFromGetter = $derived(source.tracked * 2);
  const derivedFromClass = $derived(`${model.label}:${model.count}`);

  let getterReadsShown = $state(0);

  function runAll() {
    obj.prop += 1;
    obj.nested.deep += 1;
    model.count += 1;
    model.label = 'changed';
    model.bumpHidden();
    getterReadsShown = getterReadCount;
  }
</script>

<div data-testid="reactivity">
  <button data-testid="run" onclick={runAll}>run</button>
  <output data-testid="bare-read">{bareReadEffects}</output>
  <output data-testid="nested">{nestedEffects}</output>
  <output data-testid="class-field">{classFieldEffects}</output>
  <output data-testid="private-getter">{privateGetterEffects}</output>
  <output data-testid="derived-getter">{derivedFromGetter}</output>
  <output data-testid="derived-class">{derivedFromClass}</output>
  <output data-testid="getter-reads">{getterReadsShown}</output>
  <output data-testid="proxy-identity">{String(obj.nested === obj.nested)}</output>
</div>
