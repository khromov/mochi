<script lang="ts">
  let loaded = $state('pending');

  $effect(() => {
    void import('./lazy').then((m) => {
      loaded = m.default();
    });
  });
</script>

<output>{loaded}</output>
