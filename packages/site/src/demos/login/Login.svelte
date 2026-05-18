<script lang="ts">
  import DemoPage from '../../components/DemoPage.svelte';
  import EnhancedLoginForm from './EnhancedLoginForm.svelte';
  import { loadSources } from '../../components/utils.ts';

  const sources = await loadSources([
    { label: 'Login.svelte', path: './src/demos/login/Login.svelte' },
    { label: 'EnhancedLoginForm.svelte', path: './src/demos/login/EnhancedLoginForm.svelte' },
    { label: 'session.ts', path: './src/demos/login/session.ts' },
    { label: 'routes.ts', path: './src/demos/login/routes.ts' },
    { label: 'index.ts', path: './src/demoIndex.ts' },
  ]);

  let { currentUser } = $props<{ currentUser: string | null }>();
</script>

<DemoPage
  title="Form Actions"
  description={`Forms can render as plain HTML forms or progressively enhanced forms powered by JavaScript. Plain HTML does a full POST and page re-render; {@attach enhance(...)} submits via fetch and updates the UI in place. Sign in with any username / hunter2 as a password.`}
  {sources}
>
  <h3>With <code>{'{@attach enhance(...)}'}</code></h3>
  <EnhancedLoginForm initialUser={currentUser} mochi:hydrate />
  <h3>Plain HTML</h3>
  <EnhancedLoginForm initialUser={currentUser} />
</DemoPage>

<style>
  h3 {
    margin: 1.5rem 0 0.25rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  code {
    background: var(--code-bg);
    color: var(--code-accent);
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
