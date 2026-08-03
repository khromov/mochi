<script lang="ts">
  // A child component that simply renders whatever `marks` snippet it is given.
  let { marks }: { marks: any } = $props();
</script>

{@render marks({ value: 1 })}
