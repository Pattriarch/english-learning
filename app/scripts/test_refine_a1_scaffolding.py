import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import refine_a1_scaffolding as migration


class PublishedMigrationTests(unittest.TestCase):
    def test_published_clone_does_not_require_private_pre_migration_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = Path(tmp)
            (app / 'content').mkdir()
            (app / 'content/a1-scaffolding-review.json').write_text(
                json.dumps({'id': migration.MIGRATION}), encoding='utf-8')
            with patch.object(migration, 'APP', app), patch.object(migration, 'finalize') as finalize, patch.object(migration, 'persist_corrections') as persist:
                migration.main()
                finalize.assert_called_once()
                persist.assert_not_called()
            self.assertFalse((app / 'data').exists())


if __name__ == '__main__':
    unittest.main()
