<script lang="ts">
  import { onMount } from 'svelte';

  type Step = { title: string; body: string; file: string; html: string };

  let { steps }: { steps: Step[] } = $props();

  let active = $state(0);
  let hydrated = $state(false);
  const current = $derived(steps[active]);

  onMount(() => {
    hydrated = true;
  });

  function watchSteps(list: HTMLElement) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            active = Number((entry.target as HTMLElement).dataset.step);
          }
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const item of list.children) {
      observer.observe(item);
    }
    return () => observer.disconnect();
  }
</script>

<div class="story" class:story-live={hydrated}>
  <ol class="story-steps" {@attach watchSteps}>
    {#each steps as step, i (step.title)}
      <li class="story-step" class:active={active === i} data-step={i}>
        <span class="story-num">{i + 1}</span>
        <div class="story-text">
          <h3>{step.title}</h3>
          <p>{step.body}</p>
          <div class="story-inline">
            <span class="story-file">{step.file}</span>
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            {@html step.html}
          </div>
        </div>
      </li>
    {/each}
  </ol>
  {#if current}
    <div class="story-panel">
      <div class="story-panel-head">
        <span>{current.file}</span>
        <span>Step {active + 1} of {steps.length}</span>
      </div>
      {#key active}
        <div class="story-code">
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          {@html current.html}
        </div>
      {/key}
    </div>
  {/if}
</div>
