<script>
  const boom = () => {
    throw new Error('AlwaysThrows: deliberate server failure');
  };
</script>

<p>{boom()}</p>
