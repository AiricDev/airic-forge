# CertReporter P0 integration

CertReporter remains the owner of report state, authorization, schema validation,
revision checks and command receipts. AiricForge receives a CertReporter bearer
token only for the in-memory lifetime of an App Session.

## Required CertReporter endpoints

- `GET /api/v1/users/me/` returns the authenticated user's stable id and email.
- `GET /airic/v1/manifest` returns the accepted capability manifest.
- `GET /airic/v1/openapi` returns the authenticated OpenAPI 3.1 projection.
- `POST /airic/v1/queries/report.context` returns authoritative report context.
- `POST /airic/v1/commands/{capabilityId}` accepts `commandId`, `workId`, `actionId`, `expectedDomainRelease` and typed input.
- `GET /airic/v1/commands/receipts/{commandId}` returns an existing command receipt without replaying the command.

## Drawer flow

1. The report drawer saves all local edits before it sends a task.
2. It calls `POST /api/v1/app-sessions/bootstrap` at AiricForge with the CertReporter bearer token, report id and a selection hint.
3. AiricForge validates the identity and obtains `report.context` itself. The browser-provided selection is only a focus hint.
4. The drawer opens `/acp` with the short-lived bootstrap ticket and sends `session/new`, then `session/prompt` JSON-RPC messages.
5. Loss of the ACP connection does not alter the Work. A new bootstrap is required to restore authority for another business command.
