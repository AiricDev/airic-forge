# AiricForge Material UI workspace

This is the production UI, independent of the external prototype. See [workspace routing and contracts](../../docs/workbench.md).

- `pnpm --filter @airic-forge/workbench check`
- `pnpm --filter @airic-forge/workbench build`
- `pnpm --filter @airic-forge/workbench test`
- `pnpm --filter @airic-forge/workbench format:check`
- `pnpm test:e2e` from the repository root (build domain, API and UI first).

Vite writes to `public/`, the API's existing same-origin distribution directory. This directory is generated and ignored by Git. Source, configuration, dependencies and tests are versioned. Browser tests use a disposable backend and deterministic Reflection model; they never mutate business data.
