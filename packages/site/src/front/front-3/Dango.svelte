<script lang="ts">
  let { size = 120 }: { size?: number } = $props();
</script>

<svg class="dango" width={Math.round(size * 0.38)} height={size} viewBox="0 0 38 100" aria-hidden="true">
  <rect x="17.5" y="1" width="3" height="98" rx="1.5" fill="var(--dango-stick, #d8b27c)" />
  <circle cx="19" cy="19" r="15.5" fill="var(--dango-1, #f2a3b5)" stroke="var(--dango-stroke, rgba(59, 31, 36, 0.14))" stroke-width="1.2" />
  <circle cx="19" cy="49" r="15.5" fill="var(--dango-2, #fffaf5)" stroke="var(--dango-stroke, rgba(59, 31, 36, 0.14))" stroke-width="1.2" />
  <circle cx="19" cy="79" r="15.5" fill="var(--dango-3, #a8c686)" stroke="var(--dango-stroke, rgba(59, 31, 36, 0.14))" stroke-width="1.2" />
  <ellipse cx="13.5" cy="13.5" rx="4.5" ry="3" fill="#fff" opacity="0.55" />
  <ellipse cx="13.5" cy="43.5" rx="4.5" ry="3" fill="#fff" opacity="0.8" />
  <ellipse cx="13.5" cy="73.5" rx="4.5" ry="3" fill="#fff" opacity="0.45" />
</svg>

<style>
  .dango {
    display: block;
    overflow: visible;
  }
</style>
