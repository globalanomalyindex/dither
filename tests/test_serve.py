from __future__ import annotations

import ast
from pathlib import Path
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SERVER_SOURCE = REPOSITORY_ROOT / "serve.py"


class PortableServerContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.source = SERVER_SOURCE.read_text(encoding="utf-8")
        self.tree = ast.parse(self.source)

    def test_server_does_not_contain_a_machine_specific_user_path(self) -> None:
        self.assertNotIn("/Users/", self.source)

    def test_server_resolves_the_default_root_from_its_own_file(self) -> None:
        self.assertIn("Path(__file__).resolve().parent", self.source)

    def test_server_exposes_a_testable_factory_and_main_guard(self) -> None:
        function_names = {
            node.name for node in self.tree.body if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("create_server", function_names)

        has_main_guard = any(
            isinstance(node, ast.If)
            and isinstance(node.test, ast.Compare)
            and isinstance(node.test.left, ast.Name)
            and node.test.left.id == "__name__"
            for node in self.tree.body
        )
        self.assertTrue(has_main_guard)


if __name__ == "__main__":
    unittest.main()
