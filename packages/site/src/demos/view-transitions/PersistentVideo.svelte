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
</style>
