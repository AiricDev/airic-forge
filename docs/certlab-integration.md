# CertLab MCP integration

Forge connects to one configured CertLab and one certification organization through MCP.
The authoritative wire contract is CertLab `docs/api/assistant-protocol.md`.
Historical B1–B5 records do not define current HTTP endpoints.

## Boundaries

- `apps/api/src/mcp-client.ts`: official TypeScript SDK, bounded Streamable HTTP JSON,
  paginated discovery, per-operation credential isolation and connection cleanup.
- `apps/api/src/certlab-client.ts`: CertLab identity/organization binding, normalized
  catalog mapping, material provenance/budgets and original receipt validation.
- `packages/domain/src/ports.ts` and `use-cases.ts`: provider-independent application
  capability port; accepted catalog, WD restrictions, report binding, Action state and recovery.
- CertLab `interfaces/mcp.py`: official Python SDK and serialization/authentication.
  `application/assistant/` still delegates effects to original business services.
- No SDK types enter either domain/application layer. No generic HTTP proxy,
  plugin platform, OAuth platform or multi-App selector is added.

`FORGE_CERTLAB_URL` remains the trusted App origin; MCP is at `/mcp` on that origin.
`/api/v1/auth/me` remains authoritative for actor/email. `integration.info` binds
the App/organization/business release. App bearer tokens stay in memory and are never
forwarded on redirects. An SDK connection is not a user, Work or business receipt.

## Discovery and invocation

Each published capability is a named MCP tool. Standard tool schemas/descriptions
replace manifest plus OpenAPI-path validation. Only minimal execution kind/receipt
scope metadata is namespaced under `ai.airic/execution`; it is not another manifest.
The internal catalog is a normalized review snapshot, not a second wire protocol.

Administrators accept the actual catalog; WD explicitly allows business tools.
Schema/description/execution-hint changes require review; discovery order does not.
Control tools (`integration.info`, `command.context`, `command.receipt`) are not exposed
to the model. MCP annotations are hints, never authorization or replay guarantees.

The model provides business input only. Forge enforces the bound report and injects
original commandId/release/correlation in MCP call metadata. Request IDs are not
business keys. CertLab rechecks actual permissions, versions and report impacts
inside original short write transactions, with the original atomic audit/receipt.

Structured objects use structuredContent and images use standard image blocks.
Forge validates material revisions, locations, Unicode budgets and sanitized PNGs;
source text/pixels remain transient. It does not follow resource links.

A valid business receipt establishes committed. Explicit application refusal can
establish rejected. Transport loss, malformed responses or server failures remain
unknown and block further writes. Recovery queries the original scoped receipt,
never resubmits with a new key; absence is not proof of no effect.

ACP, Work/checkpoint/feedback ownership, active OM and Reflection governance are
unchanged. Existing Work/Action/receipt identities and historical trajectories remain intact.

## Explicit cutover

There is no legacy protocol fallback. CertLab removes `/airic/v1/*` and the
Agent OpenAPI generator. Human REST/OpenAPI remains intact.

Back up and stop the existing Forge before cutover. Build the new code, then inspect:

```bash
node scripts/migrate-mcp-catalogs.mjs --data-dir /absolute/forge-data
```

Only after operator approval, add `--apply`. This creates separate MCP catalog
tables, preserves legacy catalog/acceptance rows and all user/Work/OM/trajectory data,
and is idempotent. Runtime refuses an unmigrated legacy catalog root. Do not point
the migration at a live database. It does not import tools or accept a catalog.

After both services are updated, rebootstrap and explicitly import/accept the MCP
catalog in the existing administrator flow. Old acceptance does not authorize MCP.
Stable capability IDs let existing WDs continue without silently rewriting active OM.
Unknown historical actions retain original locators and reconcile through MCP.
Deploying, applying the migration to business data and accepting the production
catalog are separate operator actions, not side effects of this refactor.

CertLab now runs its existing Django API/SPA and MCP through the same ASGI process,
using the official Python SDK and Gunicorn Uvicorn worker. Static files remain nginx-owned.

## Verification

Forge: `pnpm build`, `pnpm check`, `pnpm test`, `pnpm test:e2e`.
The targeted `certlab-contract.test.ts` exercises real SDK transport, dynamic tools,
paged catalogs, canonical ordering, credential isolation, material results and receipts.
`mcp-catalog-migration.test.ts` proves explicit, non-destructive, repeatable cutover.

CertLab's assistant tests use its real ASGI MCP endpoint. The joint
`tools/verify_airic_b1.py` probe uses real HTTP/MCP and temporary roots, with deterministic
models only. Browser tests use the ASGI test entry point, including real Copilot/ACP.

Synthetic engineering checks do not establish professional model quality.
No existing runtime roots, App tokens or business databases are used for validation.