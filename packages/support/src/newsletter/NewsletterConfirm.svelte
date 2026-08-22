<script lang="ts">
  import TokenPage from './TokenPage.svelte';
  import type { TokenPageState } from './routes';

  let { state }: { state: TokenPageState } = $props();

  const copy: Record<TokenPageState, { heading: string; body: string }> = {
    confirmed: { heading: "You're subscribed 🎉", body: 'Thanks for confirming — the next Mochi newsletter will land in your inbox. Every issue carries an unsubscribe link.' },
    already: { heading: "You're already subscribed", body: 'This address is confirmed. Nothing more to do.' },
    expired: { heading: 'This link has expired', body: 'Confirmation links are good for a limited time. Sign up again from any blog post and we will send a fresh one.' },
    unsubscribed: { heading: 'This address was unsubscribed', body: 'Subscribe again from any blog post to start receiving the newsletter.' },
    unknown: {
      heading: "This link doesn't work",
      body: 'It may have already been replaced by a newer confirmation email. Check for the most recent one, or sign up again from any blog post.',
    },
  };

  const shown = $derived(copy[state]);
</script>

<TokenPage title="Confirm your subscription — Mochi" heading={shown.heading} body={shown.body} />
