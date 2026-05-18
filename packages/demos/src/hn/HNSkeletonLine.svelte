<script>
  let { width = '100%', height = '10px' } = $props();
</script>

<span class="skeleton-line" style="width: {width}; height: {height};"></span>

<style>
  .skeleton-line {
    display: block;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--hn-skeleton-from) 0%, var(--hn-skeleton-to) 50%, var(--hn-skeleton-from) 100%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.4s ease-in-out infinite;
  }

  @keyframes skeleton-shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }
</style>
