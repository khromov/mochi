<script lang="ts">
  import { cookies } from 'mochi-framework';

  let theme = $state(cookies.get('theme') ?? 'light');
</script>

<button
  onclick={() => {
    theme = theme === 'light' ? 'dark' : 'light';
    cookies.set('theme', theme);
  }}>{theme}</button
>
