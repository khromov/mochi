<script lang="ts">
  import TokenPage from './TokenPage.svelte';
  import type { TokenPageState } from './routes';

  let { state }: { state: TokenPageState } = $props();

  const heading = $derived(state === 'unknown' ? "This link doesn't work" : "You're unsubscribed");
  const body = $derived(
    state === 'unknown'
      ? 'We could not find this address. It may already have been removed.'
      : 'That address will not receive the Mochi newsletter any more. Sign up again from any blog post if you change your mind.',
  );
</script>

<TokenPage title="Unsubscribe — Mochi" {heading} {body} />
