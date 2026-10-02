#!/usr/bin/env python3
"""Prove a three-root snapshot restores version, trace, proposal and receipt links."""

import json
import shutil
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from state_archive import create, restore, verify  # noqa: E402


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class ThreeRootRecovery(unittest.TestCase):
    def test_snapshot_and_restore_keep_cross_store_evidence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="forge-stage-five-") as temp:
            root = Path(temp)
            state = root / "state"
            project = state / "forge-project"
            data = state / "forge-data"
            app = state / "certreporter-data"
            project.mkdir(parents=True)
            data.mkdir(parents=True)
            app.mkdir(parents=True)
            git(project, "init", "--initial-branch=main")
            (project / "work.yml").write_text("id: report-authoring\n")
            git(project, "add", ".")
            git(project, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "base")
            old_revision = git(project, "rev-parse", "HEAD")
            git(project, "branch", "users/u1")
            user_tree = data / "worktrees" / "users" / "u1"
            user_tree.parent.mkdir(parents=True)
            git(project, "worktree", "add", str(user_tree), "users/u1")
            (user_tree / "work.yml").write_text("id: report-authoring\nknowledge: [new-note]\n")
            git(user_tree, "add", ".")
            git(user_tree, "-c", "user.name=Test", "-c", "user.email=test@localhost", "commit", "-m", "adopt")
            active_revision = git(user_tree, "rev-parse", "HEAD")
            proposal = data / "worktrees" / "proposals" / "p1"
            proposal.parent.mkdir(parents=True)
            git(project, "worktree", "add", "-b", "proposals/p1", str(proposal), active_revision)
            (proposal / "work.yml").write_text("id: report-authoring\nknowledge: [new-note, draft-note]\n")
            with sqlite3.connect(data / "forge.sqlite") as database:
                database.executescript("CREATE TABLE users(id TEXT); CREATE TABLE works(id TEXT, entity_id TEXT); CREATE TABLE turns(id TEXT, om_revision TEXT); CREATE TABLE reflections(id TEXT); CREATE TABLE proposals(id TEXT, worktree_path TEXT);")
                database.execute("INSERT INTO users VALUES ('u1')")
                database.execute("INSERT INTO works VALUES ('w1', 'report-1')")
                database.execute("INSERT INTO turns VALUES ('t1', ?)", (old_revision,))
                database.execute("INSERT INTO reflections VALUES ('r1')")
                database.execute("INSERT INTO proposals VALUES ('p1', ?)", (str(proposal),))
            trace = data / "trajectories" / "w1"
            trace.mkdir(parents=True)
            (trace / "segment-0001.jsonl").write_text(json.dumps({"id": "e1", "workId": "w1", "turnId": "t1", "commandId": "c1"}) + "\n")
            with sqlite3.connect(app / "db.sqlite3") as database:
                database.executescript("CREATE TABLE command_receipts(command_id TEXT, report_id TEXT, status TEXT);")
                database.execute("INSERT INTO command_receipts VALUES ('c1', 'report-1', 'committed')")
            (app / "media").mkdir()
            (app / "media" / "evidence.txt").write_text("test evidence")
            backup = root / "backup"
            create(state, backup)
            self.assertEqual(verify(backup)["facts"]["forge_main"], old_revision)
            for name in ("forge-project", "forge-data", "certreporter-data"):
                shutil.rmtree(state / name)
            restore(backup, state)
            self.assertEqual(git(project, "rev-parse", "users/u1"), active_revision)
            self.assertEqual((proposal / "work.yml").read_text(), "id: report-authoring\nknowledge: [new-note, draft-note]\n")
            self.assertEqual(json.loads((trace / "segment-0001.jsonl").read_text())["commandId"], "c1")
            with sqlite3.connect(data / "forge.sqlite") as database:
                self.assertEqual(database.execute("SELECT om_revision FROM turns WHERE id='t1'").fetchone()[0], old_revision)
                self.assertEqual(database.execute("SELECT id FROM reflections").fetchone()[0], "r1")
                self.assertEqual(database.execute("SELECT worktree_path FROM proposals").fetchone()[0], str(proposal))
            with sqlite3.connect(app / "db.sqlite3") as database:
                self.assertEqual(database.execute("SELECT status FROM command_receipts WHERE command_id='c1' AND report_id='report-1'").fetchone()[0], "committed")
            self.assertEqual((app / "media" / "evidence.txt").read_text(), "test evidence")
            with self.assertRaisesRegex(ValueError, "empty"):
                restore(backup, state)
            with (backup / "forge-data.tar.gz").open("ab") as archive:
                archive.write(b"tamper")
            with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                verify(backup)


if __name__ == "__main__":
    unittest.main()
