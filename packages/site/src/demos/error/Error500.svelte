<script>
  throw new Error('This route throws on purpose to demonstrate the errorPage.');
</script>

<p>You should never see this — the page throws during SSR.</p>
