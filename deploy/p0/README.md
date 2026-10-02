# AiricForge P0 single-host deployment

This example runs one CertReporter and one independent AiricForge container. It uses local bind mounts for the three durable roots: `state/forge-project` (`/project`), `state/forge-data` (`/data`), and `state/certreporter-data` (CertReporter `/data`). Keep `.env` and backup archives outside Git and restrict their filesystem access. Back up the persistent `DJANGO_SECRET_KEY` separately; it is required to recover CertReporter sessions and signed data.

1. Copy `.env.example` to `.env`. Select a **compatible, pinned** CertReporter image containing the Forge Report Drawer and `/airic/v1` endpoints. Its frontend server must proxy `/airic/v1` to Django for Forge-to-App calls. Set the persistent Django secret, initial Forge admin emails, and Forge model configuration. The example uses HTTP bound to localhost; put TLS and hostnames in front of both services for a remote deployment and adjust allowed origins and secure cookies accordingly.
2. Run `docker compose --env-file .env up -d --build` here. Check `docker compose ps`, `http://127.0.0.1:3000/api/v1/health/` and `http://127.0.0.1:4175/health`. Open a Report in CertReporter, then bootstrap its Forge assistant. The Report Drawer talks to Forge over `/forge` and ACP WebSocket.
3. `CERTREPORTER_AIRIC_ENABLED=0` makes the P0 Report path independent of the legacy sidecar and its internal signing keys, model catalog and health probe. The old Report Type assistant still uses that sidecar; this example does not offer that separate feature. Migrate it in its own Work Type before retiring legacy code globally.

## Coordinated backup

From the repository root, run `scripts/backup-p0.sh /absolute/backup/snapshot-name`. It stops both services, archives all three roots, verifies Git and both SQLite databases, writes SHA-256 checksums, then restarts services even if snapshot creation fails. Backups contain report data and personal Work histories; protect them as sensitive data. Copy the complete snapshot folder and `.env` secret material to the recovery location through your approved backup system.

## Restore rehearsal or recovery

1. Stop both services. Preserve the existing `state/` directory separately; restore refuses to overwrite it. Create an empty `state/` directory. The Compose mounts must still present Forge data as `/project` and `/data` inside its container. Git linked worktrees contain those container paths; changing them requires a separate `git worktree repair` procedure.
2. Run `python3 ../../scripts/state_archive.py verify --backup /absolute/backup/snapshot-name` and `python3 ../../scripts/state_archive.py restore --backup /absolute/backup/snapshot-name --state ./state` from this directory.
3. Restore the same persistent Django secret and compatible images; run `docker compose --env-file .env up -d`. Recheck both health endpoints. Sign in, find the previous Work/Turn/Reflection/Proposal, compare its OM revision with the restored Git branch, and query a saved CertReporter receipt by the original `commandId`. Do not replay a command with an unknown result.

`scripts/acceptance/stage-five-archive-test.py` rehearses snapshot, deletion and restore on isolated data, including old/new Git revisions, a pending Proposal worktree, JSONL trace, Reflection, CertReporter receipt and media. It also verifies checksum corruption and overwrite rejection. The `P0_STATE_ROOT` override is intended for an isolated restore rehearsal; `scripts/backup-p0.sh` targets the default `./state` location.
