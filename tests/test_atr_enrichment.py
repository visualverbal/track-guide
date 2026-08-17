import tempfile
import unittest
from pathlib import Path

from atr_enrichment import (
    AtrClient,
    AtrEnricher,
    AtrUnavailable,
    atr_market_context,
    match_atr_racecard,
    normalize_atr_runner_name,
    parse_atr_html,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "atr_dunstall_r6.html"
SOURCE_URL = "https://greyhounds.attheraces.com/racecard/GB/dunstall-park/17-August-2026/1226"


def dunstall_market():
    names = ["Flyhigh Star", "Moulton Melanie", "Sparta Bell", "Isaacs Hope", "Lynnia Rose", "Mylane Friend"]
    # Deliberately put traps 3 and 4 out of sort-priority order to prove external traps win.
    priorities = [1, 2, 4, 3, 5, 6]
    runners = [
        {"selectionId": 2000 + index, "runnerName": name, "sortPriority": priorities[index - 1]}
        for index, name in enumerate(names, start=1)
    ]
    catalogue = {
        "marketId": "1.dunstall-r6",
        "marketName": "R6 480m A4",
        "marketStartTime": "2026-08-17T11:26:00Z",
        "event": {"name": "Dunstall Park", "venue": "Dunstall Park", "countryCode": "GB"},
        "runners": runners,
    }
    book = {"runners": [{"selectionId": runner["selectionId"], "status": "ACTIVE"} for runner in runners]}
    return catalogue, book


class AtrParsingTests(unittest.TestCase):
    def setUp(self):
        self.html = FIXTURE.read_text(encoding="utf-8")
        self.card = parse_atr_html(self.html, SOURCE_URL)

    def test_normalizes_wide_runner_suffix(self):
        self.assertEqual(normalize_atr_runner_name("6. Mylane Friend (W)"), "mylanefriend")

    def test_extracts_dunstall_card(self):
        self.assertEqual((self.card["venue"], self.card["raceNumber"], self.card["distance"]), ("Dunstall Park", 6, 480))
        self.assertEqual(len(self.card["runners"]), 6)
        by_name = {runner["normalizedName"]: runner for runner in self.card["runners"]}
        self.assertEqual(by_name["flyhighstar"]["actualBox"], 1)
        self.assertEqual(by_name["flyhighstar"]["topSpeed"], 100)
        self.assertEqual(by_name["flyhighstar"]["form"], "31261")
        self.assertEqual(by_name["flyhighstar"]["quickForm"], 73)
        self.assertEqual(by_name["mylanefriend"]["earlyRank"], 1)
        self.assertEqual(by_name["spartabell"]["earlyRank"], 2)
        self.assertEqual(by_name["isaacshope"]["earlyRank"], 3)
        self.assertIsNone(by_name["flyhighstar"]["earlyRank"])

    def test_matches_every_runner_and_uses_atr_traps(self):
        catalogue, book = dunstall_market()
        enriched, status = match_atr_racecard(catalogue, book, atr_market_context(catalogue), self.card)
        self.assertEqual(status["matchedRunners"], 6)
        self.assertEqual(status["runnerOverlap"], 1.0)
        by_name = {normalize_atr_runner_name(runner["runnerName"]): runner for runner in enriched["runners"]}
        self.assertEqual(by_name["spartabell"]["sortPriority"], 4)
        self.assertEqual(by_name["spartabell"]["actualBox"], 3)
        self.assertEqual(by_name["isaacshope"]["sortPriority"], 3)
        self.assertEqual(by_name["isaacshope"]["actualBox"], 4)
        self.assertEqual(by_name["mylanefriend"]["atr"]["earlyRank"], 1)
        self.assertEqual(by_name["flyhighstar"]["atr"]["ratingLabel"], "Top Speed")

    def test_uses_british_summer_time_in_source_url(self):
        catalogue, _book = dunstall_market()
        context = atr_market_context(catalogue)
        self.assertEqual(context["startCode"], "1226")
        self.assertEqual(AtrClient.race_url(context), SOURCE_URL)

    def test_rejects_wrong_race(self):
        catalogue, book = dunstall_market()
        catalogue["marketName"] = "R5 480m A4"
        with self.assertRaises(AtrUnavailable):
            match_atr_racecard(catalogue, book, atr_market_context(catalogue), self.card)


class StubAtrClient(AtrClient):
    def __init__(self, cache_dir, html):
        super().__init__(cache_dir)
        self.html = html
        self.fetches = []

    def _fetch_text(self, url):
        self.fetches.append(url)
        return self.html


class AtrCacheImportTests(unittest.TestCase):
    def test_fetches_once_and_reuses_disk_cache(self):
        catalogue, _book = dunstall_market()
        context = atr_market_context(catalogue)
        html = FIXTURE.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            first = StubAtrClient(Path(temporary), html)
            first.get_racecard(context)
            first.get_racecard(context)
            self.assertEqual(first.fetches, [AtrClient.meeting_url(context), SOURCE_URL])
            second = StubAtrClient(Path(temporary), html)
            self.assertEqual(second.get_racecard(context)["raceNumber"], 6)
            self.assertEqual(second.fetches, [])

    def test_browser_import_is_validated_and_cached(self):
        catalogue, book = dunstall_market()
        with tempfile.TemporaryDirectory() as temporary:
            enricher = AtrEnricher(Path(temporary))
            enriched, status = enricher.import_html(catalogue, book, FIXTURE.read_text(encoding="utf-8"), SOURCE_URL)
            self.assertEqual(status["status"], "matched")
            self.assertTrue(status["imported"])
            self.assertEqual(status["matchedRunners"], 6)
            reused, reused_status = enricher.enrich(catalogue, book)
            self.assertEqual(reused_status["sourceMethod"], "Browser import")
            self.assertEqual(reused["runners"][0]["formData"]["rating"], 100)


if __name__ == "__main__":
    unittest.main()

