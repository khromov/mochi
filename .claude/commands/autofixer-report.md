Run the Svelte autofixer report script:

```
bun .claude/autofixer-report.ts
```

This scans all `.svelte` files in the project, runs each through the Svelte MCP server's `svelte-autofixer` tool (targeting Svelte 5), and writes `REPORT.md` with the findings.

After the script completes, read `REPORT.md` and present a summary to the user: how many files were scanned, how many had issues, and list the key issues found.
