#!/usr/bin/env python3
"""Offline snapshot and restore for the three P0 durable data roots.

The caller must stop both services first. This tool never mutates source data.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import tarfile
from datetime import UTC, datetime
from pathlib import Path


ROOTS = ("forge-project", "forge-data", "certreporter-data")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(*args: str, cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def sqlite_ok(path: Path) -> None:
    if not path.is_file():
        raise ValueError(f"Missing SQLite database: {path}")
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError(f"SQLite integrity check failed: {path}")
    finally:
        connection.close()


def inspect_state(state: Path) -> dict[str, str]:
    for name in ROOTS:
        if not (state / name).is_dir():
            raise ValueError(f"Missing data root: {state / name}")
    project = state / "forge-project"
    if not (project / ".git").is_dir():
        raise ValueError("Forge project must contain its Git repository")
    run("git", "fsck", "--no-reflogs", "--no-progress", cwd=project)
    forge_db = state / "forge-data" / "forge.sqlite"
    app_db = state / "certreporter-data" / "db.sqlite3"
    sqlite_ok(forge_db)
    sqlite_ok(app_db)
    facts = {"forge_main": run("git", "rev-parse", "main", cwd=project)}
    with sqlite3.connect(f"file:{forge_db}?mode=ro", uri=True) as database:
        for table in ("users", "works", "turns", "reflections", "proposals"):
            facts[table] = str(database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for (revision,) in database.execute("SELECT DISTINCT om_revision FROM turns"):
            run("git", "cat-file", "-e", f"{revision}^{{commit}}", cwd=project)
    with sqlite3.connect(f"file:{app_db}?mode=ro", uri=True) as database:
        tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        receipt_table = "airic_command_receipts" if "airic_command_receipts" in tables else "command_receipts"
        if receipt_table not in tables:
            raise ValueError("CertReporter command receipt table is missing")
        facts["app_receipts"] = str(database.execute(f"SELECT COUNT(*) FROM {receipt_table}").fetchone()[0])
    return facts


def create(state: Path, output: Path) -> None:
    state = state.resolve()
    output = output.resolve()
    if output == state or state in output.parents:
        raise ValueError("Backup output must be outside the live state root")
    if output.exists():
        raise ValueError(f"Backup output already exists: {output}")
    facts = inspect_state(state)
    output.mkdir(parents=True)
    try:
        archives = {}
        for name in ROOTS:
            path = output / f"{name}.tar.gz"
            with tarfile.open(path, "w:gz") as archive:
                archive.add(state / name, arcname=name, recursive=True)
            archives[name] = {"file": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}
        manifest = {"schema": 1, "created_at": datetime.now(UTC).isoformat(), "roots": archives, "facts": facts}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
        verify(output)
    except BaseException:
        import shutil
        shutil.rmtree(output)
        raise


def verify(backup: Path) -> dict:
    manifest = json.loads((backup / "manifest.json").read_text())
    if manifest.get("schema") != 1 or set(manifest.get("roots", {})) != set(ROOTS):
        raise ValueError("Invalid backup manifest")
    for name in ROOTS:
        item = manifest["roots"][name]
        path = backup / f"{name}.tar.gz"
        if item.get("file") != path.name or item.get("bytes") != path.stat().st_size or item.get("sha256") != sha256(path):
            raise ValueError(f"Backup checksum mismatch: {name}")
        with tarfile.open(path, "r:gz") as archive:
            members = archive.getmembers()
            if not members or any(member.name != name and not member.name.startswith(name + "/") for member in members):
                raise ValueError(f"Unexpected archive path: {name}")
            if any(member.issym() or member.islnk() or not (member.isdir() or member.isfile()) for member in members):
                raise ValueError(f"Unsupported archive entry: {name}")
    return manifest


def restore(backup: Path, state: Path) -> None:
    manifest = verify(backup)
    state = state.resolve()
    if state.exists() and any(state.iterdir()):
        raise ValueError("Restore target must be empty; existing data will not be overwritten")
    state.mkdir(parents=True, exist_ok=True)
    try:
        for name in ROOTS:
            with tarfile.open(backup / f"{name}.tar.gz", "r:gz") as archive:
                archive.extractall(state, filter="data")
        facts = inspect_state(state)
        if any(facts.get(key) != value for key, value in manifest["facts"].items()):
            raise ValueError("Restored Git state differs from snapshot")
    except BaseException:
        import shutil
        for name in ROOTS:
            shutil.rmtree(state / name, ignore_errors=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    snapshot = commands.add_parser("create")
    snapshot.add_argument("--state", type=Path, required=True)
    snapshot.add_argument("--output", type=Path, required=True)
    check = commands.add_parser("verify")
    check.add_argument("--backup", type=Path, required=True)
    recovery = commands.add_parser("restore")
    recovery.add_argument("--backup", type=Path, required=True)
    recovery.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "create":
        create(args.state, args.output)
        print(f"Snapshot verified: {args.output}")
    elif args.command == "verify":
        verify(args.backup)
        print(f"Snapshot checksums verified: {args.backup}")
    else:
        restore(args.backup, args.state)
        print(f"Restored and verified: {args.state}")


if __name__ == "__main__":
    main()
