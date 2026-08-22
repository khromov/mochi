<script>
  import DemoPage from '../../components/DemoPage.svelte';
  import ServerGreeting from './ServerGreeting.svelte';
  import ServerNoProps from './ServerNoProps.svelte';
  import { loadSources } from '../../components/utils.ts';
  import { files } from './files.ts';

  const sources = await loadSources(files);
</script>

<DemoPage
  title="Server Islands"
  description="You can mark components with mochi:defer to render them on the server after the initial page is delivered. Server islands can read cookies and show personalized content and since they are a separate request, you can also cache them differently than the main page. The first island also pairs mochi:defer with a nested mochi:hydrate component so it hydrates once it loads. The downside with server islands is that they require JavaScript and have no SSR representation on the initial page load."
  {sources}
>
  <p class="delay-note">The islands below are delayed on purpose to show the loading state.</p>
  <ServerGreeting
    mochi:defer
    mochi:hydrate
    name="Visitor"
    bigProp="so theres this girl bella and she moves to forks which is rainy and sad and then theres this guy edward whos like super pale and sparkly in the sun and hes a vampire but like a vegetarian one who only eats animals and bella is like i dont care youre gorgeous and edward is like no stay away im dangerous and she is like no and then theres this werewolf jacob who is warm and shirtless and loves bella too and theres a whole love triangle thing and some evil vampires show up wanting to eat bella because she smells really good apparently and then edward leaves in the second book and bella just stares out a window for months and then she cliff dives and alice sees it in a vision and thinks shes dead and edward tries to get the vampire royalty the volturi to kill him because hes dramatic like that and bella has to fly to italy to save him and then they get back together and in the last book they get married and have a half vampire baby named renesmee which is a name and jacob imprints on the baby which is weird and then bella becomes a vampire and they fight the volturi with a bunch of vampire friends and nobody actually fights they just talk it out the end"
  >
    <div class="island-loading">Loading server island<span class="dots"></span></div>
  </ServerGreeting>
  <div class="spacer"></div>
  <ServerNoProps mochi:defer>
    <div class="island-loading">Loading server island<span class="dots"></span></div>
  </ServerNoProps>
</DemoPage>

<style>
  .delay-note {
    margin-bottom: 0.75rem;
    color: var(--text-subtle);
    font-size: 0.9rem;
  }

  .spacer {
    height: 0.75rem;
  }

  .island-loading {
    padding: 1rem;
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: var(--surface-muted);
    color: var(--text-subtle);
    font-style: italic;
    text-align: center;
  }

  .dots::after {
    content: '';
    display: inline-block;
    width: 1.5em;
    text-align: left;
    animation: dots 1.2s steps(4, end) infinite;
  }

  @keyframes dots {
    0% {
      content: '';
    }
    25% {
      content: '.';
    }
    50% {
      content: '..';
    }
    75% {
      content: '...';
    }
  }
</style>
