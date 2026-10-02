#!/usr/bin/env bash
# Coordinate one offline recovery point for CertReporter and AiricForge.
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$repo_dir/deploy/p0/compose.yml"
env_file="$repo_dir/deploy/p0/.env"
state_dir="$repo_dir/deploy/p0/state"
backup_dir="${1:?Usage: backup-p0.sh /absolute/backup/output-directory}"

if [[ "$backup_dir" != /* ]]; then
  echo "Backup output must be an absolute path" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  echo "Missing deployment .env: $env_file" >&2
  exit 2
fi

running="$(docker compose -f "$compose_file" --env-file "$env_file" ps --status running --services)"
if [[ "$running" != *"certreporter"* || "$running" != *"airic-forge"* ]]; then
  echo "Both CertReporter and AiricForge must be running before the coordinated snapshot" >&2
  exit 2
fi

docker compose -f "$compose_file" --env-file "$env_file" stop
restart_services() { docker compose -f "$compose_file" --env-file "$env_file" start; }
trap restart_services EXIT
python3 "$repo_dir/scripts/state_archive.py" create --state "$state_dir" --output "$backup_dir"
