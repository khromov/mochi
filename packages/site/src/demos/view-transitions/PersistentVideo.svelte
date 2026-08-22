<script lang="ts">
  import { persistentVideoScript } from './persistent.js';
</script>

<video class="vt-video" src="/mochi.mp4" autoplay muted loop playsinline></video>
<p class="vt-credit">
  Music:
  <a href="https://pixabay.com/music/world-traditional-japanese-2-437931/" target="_blank" rel="noopener noreferrer">Traditional Japanese 2 — Bounce-Bay-Records</a>
</p>
<!-- eslint-disable-next-line svelte/no-at-html-tags -- self-authored boot script (persistent.js), not end-user input; runs on initial parse to resume the video timestamp without a hydration bundle -->
{@html persistentVideoScript}

<style>
  .vt-video {
    display: block;
    width: 100%;
    margin-top: 1.5rem;
    border-radius: 12px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: linear-gradient(135deg, #2b3d33 0%, #4a7c59 100%);
    border: 1px solid var(--border);
    /* The video owns its cross-document view transition rather than going through
       <ViewTransitions keepElementSelectors>: a stable name lets the outgoing and incoming pages pair it up. */
    view-transition-name: mochi-vt-video;
  }

  /* Document-global pseudo-elements need :global() or Svelte's scoper would prune them.
     Animations are disabled and the incoming snapshot hidden because a freshly-loaded <video> usually
     hasn't painted yet, so it would otherwise flash the placeholder backdrop before the live element takes over. */
  :global(::view-transition-group(mochi-vt-video)) {
    animation: none;
  }
  :global(::view-transition-old(mochi-vt-video)) {
    animation: none;
  }
  :global(::view-transition-new(mochi-vt-video)) {
    animation: none;
    opacity: 0;
  }

  .vt-credit {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    text-align: center;
  }

  .vt-credit a {
    color: inherit;
    text-decoration: underline;
  }
</style>
