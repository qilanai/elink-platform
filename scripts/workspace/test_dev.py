"""Build provenance and local credential preservation during source ownership changes."""
import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import dev


class OwnedStudioBuildTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        self.studio = self.root / "apps/studio"
        for name in ("backend/go.mod", "web/package.json", "LICENSE", "NOTICE", "Dockerfile"):
            path = self.studio / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("source fixture\n")
        (self.root / ".gitignore").write_text(".local/\nnode_modules/\n.env\n")
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)
        root_patch = patch.object(dev, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_build_revision_includes_edits_and_new_sources_but_not_local_data(self):
        baseline = dev.studio_source_revision()
        source = self.studio / "backend/go.mod"
        original = source.read_text()
        source.write_text("changed source\n")
        self.assertNotEqual(dev.studio_source_revision(), baseline)
        source.write_text(original)
        self.assertEqual(dev.studio_source_revision(), baseline)

        added = self.studio / "backend/feature.go"
        added.write_text("package feature\n")
        with_new_file = dev.studio_source_revision()
        self.assertNotEqual(with_new_file, baseline)
        subprocess.run(["git", "add", str(added)], cwd=self.root, check=True)
        self.assertEqual(dev.studio_source_revision(), with_new_file)

        (self.studio / ".env").write_text("TEST_ONLY_SECRET=excluded\n")
        (self.studio / ".local").mkdir()
        (self.studio / ".local/media.bin").write_bytes(b"local media")
        self.assertEqual(dev.studio_source_revision(), with_new_file)
        added.unlink()
        self.assertEqual(dev.studio_source_revision(), baseline)

    def test_existing_credentials_survive_and_old_import_pin_is_not_used_for_build(self):
        env_file = self.root / ".local/dev.env"
        env_file.parent.mkdir()
        original = "POSTGRES_PASSWORD=test-only\nSTUDIO_COMMIT=old-import\nSTUDIO_BASE_IMAGE=old-image\n"
        env_file.write_text(original)
        with patch.object(dev, "ENV_FILE", env_file), contextlib.redirect_stdout(io.StringIO()):
            dev.init()
        self.assertEqual(env_file.read_text(), original)

        revision = dev.studio_source_revision()
        with patch.object(dev, "studio_source_revision", return_value=revision), patch.object(dev, "run") as run:
            dev.compose("config", "--quiet", env={"STUDIO_COMMIT": "old-import", "STUDIO_BASE_IMAGE": "old-image"})
        environment = run.call_args.kwargs["env"]
        self.assertEqual(environment["STUDIO_COMMIT"], revision)
        self.assertEqual(environment["STUDIO_BASE_IMAGE"], "elink-studio-source:dev")

    def test_incomplete_import_cannot_fall_back_to_an_upstream_checkout(self):
        (self.studio / "backend/go.mod").unlink()
        with self.assertRaisesRegex(ValueError, "Missing owned Studio source"):
            dev.studio_source_revision()


if __name__ == "__main__":
    unittest.main()
