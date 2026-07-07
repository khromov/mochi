<script lang="ts">
  // Rendered by Mochi.email({ component, props }) — server-side, no request
  // context. The scoped styles below are inlined into the HTML by the mailer.
  // The photo rides along as a real file attachment (see routes.ts), so this
  // body only needs to mention it.
  let { name, filename }: { name: string; filename: string } = $props();
</script>

<div class="email">
  <div class="brand">🍡 Mochi</div>
  <h1>A photo for you, {name}</h1>
  <p>Here's a mochi we thought you'd like — it's attached as <strong>{filename}</strong>.</p>
  <p class="muted">Open the attachment to take a look. Reply any time.</p>
</div>

<style>
  .email {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    max-width: 560px;
    margin: 0 auto;
    padding: 32px;
    color: #1f2933;
    background: #ffffff;
    line-height: 1.55;
  }

  .brand {
    font-size: 20px;
    font-weight: 700;
    color: #d6336c;
    margin-bottom: 24px;
  }

  h1 {
    font-size: 22px;
    margin: 0 0 12px;
    color: #111827;
  }

  p {
    margin: 0 0 16px;
    font-size: 15px;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
  }
</style>
