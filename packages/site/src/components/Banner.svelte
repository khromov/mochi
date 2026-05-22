<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Megaphone from '@lucide/svelte/icons/megaphone';
</script>

<div class="banner" role="region" aria-label="Project status">
  <div class="banner-inner">
    <Megaphone class="banner-icon" size={18} aria-hidden="true" />
    <p class="banner-text">
      <strong>Mochi is currently in alpha</strong> — be the first to
      <a class="banner-link" href="https://discord.com/invite/QCGfks4gg8" rel="noopener noreferrer" target="_blank">
        join our Discord<ArrowUpRight class="banner-link-icon" size={14} aria-hidden="true" />
      </a>
      to shape the future of the framework.
    </p>
  </div>
</div>

<style>
  .banner {
    background: linear-gradient(180deg, #f5a35a 0%, #ec7a2c 100%);
    color: #3a1a05;
    border-bottom: 1px solid #b85213;
    box-shadow: inset 0 -1px 0 rgba(255, 220, 180, 0.25);
  }

  .banner-inner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    padding: 0.55rem 1.25rem;
    text-align: center;
  }

  .banner :global(.banner-icon) {
    flex: none;
    color: #5a2606;
  }

  .banner-text {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.4;
    color: inherit;
  }

  .banner-text strong {
    font-weight: 700;
    color: #2e1304;
  }

  .banner-link {
    display: inline-flex;
    align-items: center;
    gap: 0.22rem;
    color: #2e1304;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1.5px;
    text-decoration-color: rgba(46, 19, 4, 0.45);
    transition:
      text-decoration-color 0.15s ease,
      color 0.15s ease;
  }

  .banner-link :global(.banner-link-icon) {
    transform: translateY(-0.5px);
    transition: transform 0.18s ease;
  }

  .banner-link:hover {
    color: #000;
    text-decoration-color: #000;
  }

  .banner-link:hover :global(.banner-link-icon) {
    transform: translate(1.5px, -2px);
  }

  @media (max-width: 640px) {
    .banner-inner {
      gap: 0.5rem;
      padding: 0.5rem 0.85rem;
    }

    .banner-text {
      font-size: 0.8rem;
      line-height: 1.35;
      text-align: left;
    }
  }
</style>
