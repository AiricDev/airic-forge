# CertReporter P0 integration

CertReporter remains the owner of report state, authorization, schema validation,
revision checks and command receipts. AiricForge receives a CertReporter bearer
token only for the in-memory lifetime of an App Session.

## Required CertReporter endpoints

- `GET /api/v1/users/me/` returns the authenticated user's stable id and email.
- `GET /airic/v1/manifest` returns the App-published capability manifest. Forge accepts a version separately before registering tools.
- `GET /airic/v1/openapi` returns the authenticated OpenAPI 3.1 projection.
- `POST /airic/v1/queries/report.context` returns authoritative report context.
- `POST /airic/v1/commands/{capabilityId}` accepts `commandId`, `workId`, `actionId`, `expectedDomainRelease` and typed input.
- `GET /airic/v1/commands/receipts/{commandId}` returns an existing command receipt without replaying the command.

When Forge uses CertReporter's container HTTP origin (port 3000), the
CertReporter frontend server must proxy `/airic/v1/*` to Django in addition to
its `/api/*` proxy. Forge must receive the same bearer-protected response at
that origin; an internal Django listener bound only to `127.0.0.1` is not
reachable from the Forge container.

## Drawer flow

1. The report drawer saves all local edits before it sends a task.
2. It calls `POST /api/v1/app-sessions/bootstrap` at AiricForge with the CertReporter bearer token, report id and a selection hint.
3. AiricForge validates the identity and obtains `report.context` itself. The browser-provided selection is only a focus hint.
4. The drawer opens `/acp` with the short-lived bootstrap ticket and sends `session/new`, then `session/prompt` JSON-RPC messages.
5. Loss of the ACP connection does not alter the Work. A new bootstrap is required to restore authority for another business command.

Bootstrap first calls `report.context` and checks that its resource is the requested
CertReporter report before it creates or resumes a Forge Work. A connection ticket
may be claimed once. Forge removes its in-memory App token when the ACP socket
closes.

When the linked Forge account has no password, bootstrap also returns
`passwordSetupTicket`. This separate, single-use ticket is sent to
`POST /api/v1/app-sessions/{passwordSetupTicket}/password`. Independent Web login
then issues a short-lived HttpOnly `forge_session` cookie. The drawer can open
the Forge workspace at `/#setup={passwordSetupTicket}`; the fragment is read by
the password setup page and removed after a successful setup.
