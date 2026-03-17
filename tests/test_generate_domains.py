"""
tests/test_generate_domains.py — unit tests for scripts/generate_domains.py.

Tests the extract_sld() helper and the full main() pipeline.

Run with:
    python3 tests/test_generate_domains.py

No external packages required (stdlib unittest only).
"""

import csv
import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import types
import unittest

# ---------------------------------------------------------------------------
# Import extract_sld directly from scripts/generate_domains.py without
# executing main() (the module has an `if __name__ == "__main__"` guard).
# ---------------------------------------------------------------------------
ROOT = pathlib.Path(__file__).parent.parent
_spec = importlib.util.spec_from_file_location(
    "generate_domains",
    ROOT / "scripts" / "generate_domains.py",
)
_mod: types.ModuleType = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

extract_sld = _mod.extract_sld


# ---------------------------------------------------------------------------
# extract_sld tests
# ---------------------------------------------------------------------------

class TestExtractSld(unittest.TestCase):

    # --- typical top-100 entries ---

    def test_simple_com(self):
        self.assertEqual(extract_sld("apple.com"), "apple")

    def test_subdomain_like_entry(self):
        """googleapis.com -> googleapis (not 'google')"""
        self.assertEqual(extract_sld("googleapis.com"), "googleapis")

    def test_hyphenated_sld(self):
        """cdn-apple.com -> cdn-apple"""
        self.assertEqual(extract_sld("cdn-apple.com"), "cdn-apple")

    def test_single_label_tld(self):
        """dns.google -> dns  (TLD is 'google')"""
        self.assertEqual(extract_sld("dns.google"), "dns")

    def test_net_tld(self):
        self.assertEqual(extract_sld("cloudflare.net"), "cloudflare")

    def test_org_tld(self):
        self.assertEqual(extract_sld("wikipedia.org"), "wikipedia")

    def test_io_tld(self):
        self.assertEqual(extract_sld("github.io"), "github")

    # --- edge cases ---

    def test_no_dot_returns_whole_string(self):
        """rsplit('.', 1) on a string with no dot gives a 1-element list."""
        self.assertEqual(extract_sld("nodot"), "nodot")

    def test_multiple_dots_uses_last(self):
        """Only the last dot is the TLD boundary."""
        self.assertEqual(extract_sld("a.b.c.com"), "a.b.c")

    def test_empty_string(self):
        """rsplit on '' gives [''], index [0] is ''."""
        self.assertEqual(extract_sld(""), "")

    def test_uppercase_preserved(self):
        """extract_sld is case-neutral; main() lowercases before calling it."""
        self.assertEqual(extract_sld("Apple.COM"), "Apple")

    def test_numeric_sld(self):
        self.assertEqual(extract_sld("123.net"), "123")


# ---------------------------------------------------------------------------
# main() pipeline integration test
# ---------------------------------------------------------------------------

class TestMainPipeline(unittest.TestCase):
    """
    Runs main() against a small synthetic CSV and verifies the generated JS.
    Patches CSV_PATH and OUT_PATH so we never touch real project files.
    """

    SAMPLE_CSV = (
        "rank,domain,categories\n"
        "1,google.com,Search Engines\n"
        "2,Apple.COM,Technology\n"          # uppercase — main() lowercases
        "3,cdn-apple.com,Content Servers\n"
        "4,dns.google,DNS\n"
    )

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        tmp = pathlib.Path(self._tmp_dir.name)

        self.csv_path = tmp / "top-100.csv"
        self.csv_path.write_text(self.SAMPLE_CSV, encoding="utf-8")

        self.out_path = tmp / "top-domains.js"

        # Patch module-level paths so main() uses our temp files.
        self._orig_csv  = _mod.CSV_PATH
        self._orig_out  = _mod.OUT_PATH
        self._orig_root = _mod.ROOT
        _mod.CSV_PATH = self.csv_path
        _mod.OUT_PATH = self.out_path
        _mod.ROOT     = tmp          # keeps relative_to() happy in the print statement

    def tearDown(self):
        _mod.CSV_PATH = self._orig_csv
        _mod.OUT_PATH = self._orig_out
        _mod.ROOT     = self._orig_root
        self._tmp_dir.cleanup()

    def _run_main(self):
        _mod.main()
        return self.out_path.read_text(encoding="utf-8")

    def test_output_file_created(self):
        self._run_main()
        self.assertTrue(self.out_path.exists())

    def test_output_starts_with_comment(self):
        js = self._run_main()
        self.assertTrue(js.startswith("// Auto-generated"))

    def test_output_contains_const_declaration(self):
        js = self._run_main()
        self.assertIn("const TOP_DOMAINS =", js)

    def test_output_ends_with_semicolon(self):
        js = self._run_main()
        self.assertTrue(js.rstrip().endswith(";"))

    def _parse_entries(self):
        """Extract the JSON array from the generated JS."""
        js = self._run_main()
        json_str = js.split("const TOP_DOMAINS = ", 1)[1].rstrip().rstrip(";")
        return json.loads(json_str)

    def test_entry_count(self):
        entries = self._parse_entries()
        self.assertEqual(len(entries), 4)

    def test_domains_lowercased(self):
        entries = self._parse_entries()
        domains = [e["domain"] for e in entries]
        self.assertIn("apple.com", domains)         # was "Apple.COM" in CSV
        self.assertNotIn("Apple.COM", domains)

    def test_sld_field_present(self):
        entries = self._parse_entries()
        for e in entries:
            self.assertIn("sld", e)
            self.assertIn("domain", e)

    def test_sld_values_correct(self):
        entries = self._parse_entries()
        by_domain = {e["domain"]: e["sld"] for e in entries}
        self.assertEqual(by_domain["google.com"],    "google")
        self.assertEqual(by_domain["apple.com"],     "apple")
        self.assertEqual(by_domain["cdn-apple.com"], "cdn-apple")
        self.assertEqual(by_domain["dns.google"],    "dns")

    def test_output_dir_created_if_missing(self):
        """OUT_PATH.parent.mkdir(parents=True, exist_ok=True) should work."""
        nested = pathlib.Path(self._tmp_dir.name) / "deep" / "nested" / "top-domains.js"
        _mod.OUT_PATH = nested
        _mod.main()
        self.assertTrue(nested.exists())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
