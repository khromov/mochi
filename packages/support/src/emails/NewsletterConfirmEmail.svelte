<script lang="ts">
  // Rendered by Mochi.email() with no request context: no getRequestContext(),
  // cookies or url. The scoped styles are inlined by the mailer.
  let { confirmUrl, unsubscribeUrl }: { confirmUrl: string; unsubscribeUrl: string } = $props();
</script>

<div class="email">
  <div class="brand">🍡 Mochi</div>

  <h1>Confirm your subscription</h1>
  <p>Tap the button to start receiving the Mochi newsletter — release notes, deep dives, and the occasional demo.</p>

  <p class="cta"><a class="button" href={confirmUrl}>Confirm subscription</a></p>

  <p class="muted">Or paste this link into your browser:<br /><a href={confirmUrl}>{confirmUrl}</a></p>

  <p class="muted">Didn't sign up? Ignore this email — nothing happens until you confirm. You can also <a href={unsubscribeUrl}>remove this address</a>.</p>
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
    font-size: 15px;
    margin: 0 0 16px;
  }

  .cta {
    margin: 24px 0;
  }

  .button {
    display: inline-block;
    padding: 12px 22px;
    background: #4a7c59;
    color: #ffffff;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
    word-break: break-word;
  }

  .muted a {
    color: #4a7c59;
  }
</style>
