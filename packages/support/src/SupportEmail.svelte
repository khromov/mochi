<script lang="ts">
  // Rendered by Mochi.email({ component, props }) — this runs server-side with no
  // request context, so it must not touch getRequestContext()/cookies/url.
  // The scoped style block below is inlined into the HTML by the mailer (css-inline).
  let { name, email, message }: { name: string; email: string; message: string } = $props();
</script>

<div class="email">
  <div class="brand">🍡 Mochi</div>

  <h1>New support request</h1>
  <table class="meta">
    <tbody>
      <tr>
        <td class="label">From</td>
        <td>{name || '(no name)'}</td>
      </tr>
      <tr>
        <td class="label">Email</td>
        <td><a href="mailto:{email}">{email}</a></td>
      </tr>
    </tbody>
  </table>

  <div class="message">{message}</div>

  <p class="muted">Sent from the support form on support.mochi.fast. Reply to this email to reach the sender directly.</p>
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

  .meta {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
    font-size: 15px;
  }

  .meta td {
    padding: 8px 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .meta .label {
    width: 80px;
    color: #6b7280;
    font-weight: 600;
  }

  .meta a {
    color: #d6336c;
  }

  .message {
    font-size: 15px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 16px;
    margin: 0 0 16px;
    white-space: pre-wrap;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
    margin: 0;
  }
</style>
