<script lang="ts">
  // Rendered by Mochi.email({ component, props }) — runs server-side with no
  // request context, so it must not touch getRequestContext()/cookies/url.
  // The scoped style block below is inlined into style="" attributes by juice.
  let { subject, message }: { subject: string; message: string } = $props();
</script>

<div class="wrap">
  <div class="card">
    <div class="banner">
      <span class="badge">🍡 Mochi Mailer</span>
    </div>
    <div class="body">
      <h1>{subject}</h1>
      <p class="message">{message}</p>
      <div class="divider"></div>
      <p class="footer">Sent from the Mochi demos app via the Mailgun SMTP transport.</p>
    </div>
  </div>
</div>

<style>
  .wrap {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background: #f4f0ff;
    padding: 40px 16px;
  }

  .card {
    max-width: 520px;
    margin: 0 auto;
    background: #ffffff;
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(91, 58, 201, 0.12);
  }

  .banner {
    padding: 28px 32px;
    background: linear-gradient(135deg, #7c3aed 0%, #d6336c 100%);
  }

  .badge {
    display: inline-block;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.18);
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .body {
    padding: 32px;
  }

  h1 {
    margin: 0 0 16px;
    font-size: 22px;
    color: #1f1533;
  }

  .message {
    margin: 0;
    font-size: 15px;
    line-height: 1.6;
    color: #3f3a4d;
    white-space: pre-wrap;
  }

  .divider {
    height: 1px;
    margin: 24px 0;
    background: #ece7fb;
  }

  .footer {
    margin: 0;
    font-size: 12px;
    color: #9691a6;
  }
</style>
