<script lang="ts">
  import { enhance, isServer, isHydratable, getRequestContext } from 'mochi-framework';
  import type { MochiSubmitFunction } from 'mochi-framework';
  import Paperclip from '@lucide/svelte/icons/paperclip';

  type UploadResult = { filename: string; content: string; size: number };

  let { label }: { label: string } = $props();

  const hydrating = isHydratable();
  const _form = !hydrating && isServer ? getRequestContext().form : null;
  const initialResult: UploadResult | null = _form?.ok && _form.action === 'uploadFile' ? (_form.data as UploadResult) : null;
  const initialError: string | null = !_form?.ok && _form?.action === 'uploadFile' ? String(_form.data.error ?? '') : null;

  let fileResult = $state<UploadResult | null>(initialResult);
  let errorMessage = $state<string | null>(initialError);
  let pending = $state(false);
  let selectedName = $state<string | null>(null);

  function onFileChange(e: Event) {
    selectedName = (e.currentTarget as HTMLInputElement).files?.[0]?.name ?? null;
  }

  const handleSubmit: MochiSubmitFunction<UploadResult, { error: string }> = () => {
    pending = true;
    fileResult = null;
    errorMessage = null;
    return ({ result, formElement }) => {
      pending = false;
      if (result.type === 'success' && result.data) {
        fileResult = result.data;
        formElement.reset();
      } else if (result.type === 'failure' && result.data) {
        errorMessage = result.data.error;
      } else if (result.type === 'error') {
        errorMessage = (result.error as { message?: string })?.message ?? 'Upload failed';
      }
    };
  };
</script>

<div class="demo-block">
  <p class="label">{label}</p>
  {#if errorMessage}
    <p class="error" role="alert">{errorMessage}</p>
  {/if}
  {#if fileResult}
    <div class="file-result">
      <p class="file-meta">{fileResult.filename} &mdash; {fileResult.size} bytes</p>
      <pre class="file-content">{fileResult.content}</pre>
    </div>
  {/if}
  <form method="POST" action="?/uploadFile" enctype="multipart/form-data" {@attach enhance(handleSubmit)}>
    <div class="file-row">
      <label class="file-btn">
        <Paperclip size={15} />
        Choose file
        <input type="file" name="file" accept=".txt,.md" required onchange={onFileChange} />
      </label>
      {#if hydrating}
        <span class="file-name" class:chosen={selectedName}>{selectedName ?? 'No file chosen'}</span>
      {/if}
    </div>
    <button type="submit" disabled={pending}>{pending ? 'Uploading…' : 'Upload'}</button>
  </form>
</div>

<style>
  .demo-block {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
    margin-top: 0.75rem;
  }

  .label {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-subtle);
  }

  .error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    background: var(--badge-danger-bg);
    color: var(--badge-danger-text);
    border-radius: var(--radius-sm);
    font-size: 0.9rem;
  }

  .file-result {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .file-meta {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .file-content {
    margin: 0;
    padding: 0.75rem;
    background: var(--code-bg);
    color: var(--code-text);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 12rem;
    overflow-y: auto;
    width: 100%;
    box-sizing: border-box;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    align-items: flex-start;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .file-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem 0.85rem;
    background: var(--surface-muted);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    transition:
      background 0.1s,
      border-color 0.1s;
  }

  .file-btn:hover {
    background: var(--surface);
    border-color: var(--accent);
    color: var(--accent);
  }

  .file-btn input[type='file'] {
    display: none;
  }

  .file-name {
    font-size: 0.875rem;
    color: var(--text-subtle);
    font-family: var(--font-mono);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 18rem;
  }

  .file-name.chosen {
    color: var(--text);
  }

  button {
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: var(--accent-text);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-family: inherit;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
</style>
