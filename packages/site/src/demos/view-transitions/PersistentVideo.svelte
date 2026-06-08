<script lang="ts">
  import { onMount } from 'svelte';

  const KEY = 'mochi-vt-video-time';
  let video: HTMLVideoElement;

  onMount(() => {
    const saved = sessionStorage.getItem(KEY);
    if (saved) {
      const t = parseFloat(saved);
      const restore = () => {
        if (Number.isFinite(t)) {
          video.currentTime = t;
        }
      };
      if (video.readyState >= 1) {
        restore();
      } else {
        video.addEventListener('loadedmetadata', restore, { once: true });
      }
    }

    const save = () => sessionStorage.setItem(KEY, String(video.currentTime));
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  });
</script>

<video bind:this={video} class="vt-video" src="/mochi.mp4" autoplay muted loop playsinline></video>
<p class="vt-credit">
  Music:
  <a href="https://pixabay.com/music/world-traditional-japanese-2-437931/" target="_blank" rel="noopener noreferrer">Traditional Japanese 2 — Bounce-Bay-Records</a>
</p>

<style>
  .vt-video {
    display: block;
    width: 100%;
    margin-top: 1.5rem;
    border-radius: 12px;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    background: #000;
    border: 1px solid var(--border);
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
