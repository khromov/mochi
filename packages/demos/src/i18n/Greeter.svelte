<script lang="ts">
  const STORAGE_KEY = 'mochi-i18n-clicks';
  let count = $state(0);

  $effect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {count = Number(saved);}
  });

  $effect(() => {
    localStorage.setItem(STORAGE_KEY, String(count));
  });
</script>

<div class="greeter">
  <p class="greeter-lead">This box is a hydrated island — it became interactive in the browser, in the active language.</p>
  <button class="greeter-btn" onclick={() => count++}>Clicked {count} times</button>
</div>

<style>
  .greeter {
    margin-top: 22px;
    padding: 18px;
    border-radius: 12px;
    background: var(--green-100, #e8efe5);
    border: 1px solid var(--green-200, #d6e4d8);
    text-align: center;
  }
  .greeter-lead {
    margin: 0 0 14px;
    font-size: 14px;
    color: var(--green-700, #385c47);
  }
  .greeter-btn {
    font: inherit;
    font-weight: 600;
    padding: 9px 18px;
    border-radius: 999px;
    border: 1px solid var(--green-600, #4a7159);
    background: var(--green-600, #4a7159);
    color: #fff;
    cursor: pointer;
  }
  .greeter-btn:hover {
    filter: brightness(1.05);
  }
</style>
