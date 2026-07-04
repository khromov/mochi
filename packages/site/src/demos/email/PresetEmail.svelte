<script lang="ts">
  // Rendered by Mochi.email({ component, props }) — this runs server-side with no
  // request context, so it must not touch getRequestContext()/cookies/url.
  // The scoped style block below is inlined into the HTML by the mailer (juice).
  let { preset, name }: { preset: string; name: string } = $props();

  const receiptItems = [
    { label: 'Mochi Pro (annual)', amount: '$96.00' },
    { label: 'Priority support', amount: '$24.00' },
  ];
</script>

<div class="email">
  <div class="brand">🍡 Mochi</div>

  {#if preset === 'welcome'}
    <h1>Welcome aboard, {name}!</h1>
    <p>Thanks for signing up. Mochi renders Svelte on the server and hydrates only the islands that need it — so your pages stay fast by default.</p>
    <p><a class="button" href="https://mochi.fast/docs/">Read the docs</a></p>
    <p class="muted">Glad to have you. Reply any time — a real human reads these.</p>
  {:else if preset === 'receipt'}
    <h1>Thanks for your order, {name}</h1>
    <p>Here's a copy of your receipt for order <strong>#1024</strong>.</p>
    <table class="receipt">
      <tbody>
        {#each receiptItems as item (item.label)}
          <tr>
            <td>{item.label}</td>
            <td class="amount">{item.amount}</td>
          </tr>
        {/each}
        <tr class="total">
          <td>Total</td>
          <td class="amount">$120.00</td>
        </tr>
      </tbody>
    </table>
    <p class="muted">Charged to the card ending in 4242. Questions? Just reply.</p>
  {:else}
    <h1>Reset your password</h1>
    <p>Hi {name}, we received a request to reset the password on your Mochi account.</p>
    <p><a class="button" href="https://mochi.fast/reset?token=demo">Choose a new password</a></p>
    <p class="muted">This link expires in 30 minutes. If you didn't ask for this, you can safely ignore this email.</p>
  {/if}
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

  .button {
    display: inline-block;
    padding: 10px 20px;
    background: #d6336c;
    color: #ffffff;
    text-decoration: none;
    border-radius: 8px;
    font-weight: 600;
    font-size: 15px;
  }

  .muted {
    color: #6b7280;
    font-size: 13px;
  }

  .receipt {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
    font-size: 15px;
  }

  .receipt td {
    padding: 10px 0;
    border-bottom: 1px solid #e5e7eb;
  }

  .receipt .amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .receipt .total td {
    border-bottom: none;
    font-weight: 700;
    padding-top: 14px;
  }
</style>
