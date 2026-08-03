<script>
  // A child that simply renders whatever `marks` snippet it is given.
  let { marks } = $props();
</script>

{@render marks({ value: 1 })}
