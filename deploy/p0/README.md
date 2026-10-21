# Historical AiricForge P0 single-host deployment

This CertReporter Compose example is an archived P0 deployment record. It does not
configure the current CertLab MCP integration and must not be used to deploy the
current runtime. See [CertLab MCP integration](../../docs/certlab-integration.md)
and the repository-root `docker-compose.yml` for the current configuration.

This example runs one CertReporter and one independent AiricForge container. It uses local bind mounts for the three durable roots: `state/forge-project` (`/project`), `state/forge-data` (`/data`), and `state/certreporter-data` (CertReporter `/data`). Keep `.env` and backup archives outside Git and restrict their filesystem access. Back up the persistent `DJANGO_SECRET_KEY` separately; it is required to recover CertReporter sessions and signed data.

1. Copy `.env.example` to `.env`. Select a **compatible, pinned** CertReporter image containing the Forge Report Drawer and `/airic/v1` endpoints. Its frontend server must proxy `/airic/v1` to Django for Forge-to-App calls. Set the persistent Django secret, Forge model configuration (current account initialization is defined in [user administration](../../docs/user-administration.md)). The example uses HTTP bound to localhost; put TLS and hostnames in front of both services for a remote deployment and adjust allowed origins and secure cookies accordingly.
2. Run `docker compose --env-file .env up -d --build` here. Check `docker compose ps`, `http://127.0.0.1:3000/api/v1/health/` and `http://127.0.0.1:4175/health`. Open a Report or editable Report Type in CertReporter, then bootstrap its Forge assistant. Both Drawers talk to Forge over `/forge` and ACP WebSocket.
3. The CertReporter image contains no legacy Airic sidecar. Forge owns both `report-authoring` and `report-type-definition` Work. PDF, DOCX and TXT attachments are extracted to bounded text for the next Turn only; the App bearer token and extracted text remain in Forge process memory.

For a persistent Forge project created before `report-type-definition` existed, take a coordinated backup, stop the Forge service, and run the explicit OM migration in a one-off Forge container: `docker compose --env-file .env run --rm --no-deps airic-forge node /app/scripts/migrate-report-type-om.mjs`. It makes a provenance commit on `main` and each checked-out user branch without replacing existing personal changes. Start Forge again afterward. New projects already contain the package.

## Coordinated backup

From the repository root, run `scripts/backup-p0.sh /absolute/backup/snapshot-name`. It stops both services, archives all three roots, verifies Git and both SQLite databases, writes SHA-256 checksums, then restarts services even if snapshot creation fails. Backups contain report data and personal Work histories; protect them as sensitive data. Copy the complete snapshot folder and `.env` secret material to the recovery location through your approved backup system.

On Docker Desktop with bind mounts, do not open the live Forge SQLite file directly from the host, even for a read-only inspection. A host SQLite connection can remove the container process's WAL and leave new Work records outside the durable database. Stop both services or use `backup-p0.sh`, then inspect the stopped data or a restored snapshot.

## Restore rehearsal or recovery

1. Stop both services. Preserve the existing `state/` directory separately; restore refuses to overwrite it. Create an empty `state/` directory. The Compose mounts must still present Forge data as `/project` and `/data` inside its container. Git linked worktrees contain those container paths; changing them requires a separate `git worktree repair` procedure.
2. Run `python3 ../../scripts/state_archive.py verify --backup /absolute/backup/snapshot-name` and `python3 ../../scripts/state_archive.py restore --backup /absolute/backup/snapshot-name --state ./state` from this directory.
3. Restore the same persistent Django secret and compatible images; run `docker compose --env-file .env up -d`. Recheck both health endpoints. Sign in, find the previous Work/Turn/Reflection/Proposal, compare its OM revision with the restored Git branch, and query a saved CertReporter receipt by the original `commandId`. Do not replay a command with an unknown result.

`scripts/acceptance/stage-five-archive-test.py` rehearses snapshot, deletion and restore on isolated data, including old/new Git revisions, a pending Proposal worktree, JSONL trace, Reflection, CertReporter receipt and media. It also verifies checksum corruption and overwrite rejection. The `P0_STATE_ROOT` override is intended for an isolated restore rehearsal; `scripts/backup-p0.sh` targets the default `./state` location.
