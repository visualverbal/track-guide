import tempfile
import unittest
from pathlib import Path

from recorder_enrichment import (
    BROWSER_HEADERS,
    RecorderClient,
    RecorderEnricher,
    RecorderUnavailable,
    market_context,
    match_racecard,
    normalize_runner_name,
    parse_recorder_html,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "northam_r9.html"
SOURCE_URL = "https://www.thegreyhoundrecorder.com.au/form-guides/northam-20260817/auto-owls-bentley-race-9/long-form/"


def northam_market():
    names = [
        "1. Armani’s Girl",
        "2. Luxio Wave",
        "3. Alison’s Mission",
        "4. Nitro Ned",
        "6. Aussie Trickster",
        "7. Charos Finale",
        "8. Crocodile Crawl",
        "10. Go Lilo Go",
    ]
    runners = [
        {"selectionId": 1000 + index, "runnerName": name, "sortPriority": index}
        for index, name in enumerate(names, start=1)
    ]
    catalogue = {
        "marketId": "1.northam-r9",
        "marketName": "R9 297m X65",
        "marketStartTime": "2026-08-17T10:30:00Z",
        "event": {
            "name": "Northam Greyhounds",
            "venue": "Northam",
            "countryCode": "AU",
            "timezone": "Australia/Perth",
        },
        "runners": runners,
    }
    book = {
        "runners": [
            {"selectionId": runner["selectionId"], "status": "ACTIVE"}
            for runner in runners
        ]
    }
    return catalogue, book


class RecorderParsingTests(unittest.TestCase):
    def setUp(self):
        self.html = FIXTURE.read_text(encoding="utf-8")
        self.card = parse_recorder_html(self.html, SOURCE_URL)

    def test_normalizes_apostrophes_and_betfair_prefixes(self):
        self.assertEqual(normalize_runner_name("1. Armani’s Girl"), "armanisgirl")
        self.assertEqual(normalize_runner_name("Armani's Girl"), "armanisgirl")

    def test_extracts_expected_northam_card(self):
        active = [runner for runner in self.card["runners"] if not runner["scratched"]]
        self.assertEqual(len(active), 8)
        extracted = {
            runner["name"]: (runner["actualBox"], runner["earlySpeed"], runner["rating"])
            for runner in active
        }
        self.assertEqual(extracted["Armani's Girl"], (1, 86, 100))
        self.assertEqual(extracted["Aussie Trickster"], (6, 57, 60))
        self.assertEqual(extracted["Go Lilo Go"], (5, 44, 86))
        scratched = {runner["name"] for runner in self.card["runners"] if runner["scratched"]}
        self.assertEqual(scratched, {"Let's Go Spike", "Just A Joker"})

    def test_matches_all_active_runners_and_does_not_use_sort_priority_as_box(self):
        catalogue, book = northam_market()
        enriched, status = match_racecard(catalogue, book, market_context(catalogue), self.card)
        self.assertEqual(status["matchedRunners"], 8)
        self.assertEqual(status["runnerOverlap"], 1.0)
        by_name = {normalize_runner_name(runner["runnerName"]): runner for runner in enriched["runners"]}
        self.assertEqual(by_name["aussietrickster"]["sortPriority"], 5)
        self.assertEqual(by_name["aussietrickster"]["actualBox"], 6)
        self.assertEqual(by_name["golilogo"]["sortPriority"], 8)
        self.assertEqual(by_name["golilogo"]["actualBox"], 5)

    def test_rejects_low_runner_overlap(self):
        catalogue, book = northam_market()
        catalogue["runners"] = catalogue["runners"][:2] + [
            {"selectionId": 2001, "runnerName": "Different Runner", "sortPriority": 3}
        ]
        book["runners"] = [
            {"selectionId": runner["selectionId"], "status": "ACTIVE"}
            for runner in catalogue["runners"]
        ]
        with self.assertRaises(RecorderUnavailable):
            match_racecard(catalogue, book, market_context(catalogue), self.card)


class StubRecorderClient(RecorderClient):
    def __init__(self, cache_dir, html):
        super().__init__(cache_dir)
        self.html = html
        self.fetches = []

    def _fetch_text(self, url):
        self.fetches.append(url)
        if url.endswith("/fields/"):
            return (
                '<a href="/form-guides/northam-20260817/auto-owls-bentley-race-9/long-form/" '
                'data-analytics="Meeting Event Selector : Race 9">9</a>'
                '<a href="/form-guides/other-track-20260817/other-race-9/long-form/" '
                'data-analytics="Next Race : Race 9">Other track</a>'
            )
        return self.html


class RecorderCacheTests(unittest.TestCase):
    def test_fetches_a_racecard_once_and_reuses_disk_cache(self):
        catalogue, _book = northam_market()
        context = market_context(catalogue)
        html = FIXTURE.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            first = StubRecorderClient(Path(temporary), html)
            first.get_racecard(context)
            first.get_racecard(context)
            self.assertEqual(len(first.fetches), 2)  # meeting discovery + one racecard

            second = StubRecorderClient(Path(temporary), html)
            card = second.get_racecard(context)
            self.assertEqual(second.fetches, [])
            self.assertEqual(card["raceNumber"], 9)
            self.assertEqual(card["sourceUrl"], SOURCE_URL)


class RecorderImportTests(unittest.TestCase):
    def test_browser_import_overrides_unavailable_result_and_is_cached(self):
        catalogue, book = northam_market()
        html = FIXTURE.read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as temporary:
            enricher = RecorderEnricher(Path(temporary))
            enricher.results[catalogue["marketId"]] = (
                catalogue,
                {"status": "unavailable", "reason": "HTTP 403"},
            )
            enriched, status = enricher.import_html(catalogue, book, html, SOURCE_URL)
            self.assertEqual(status["status"], "matched")
            self.assertTrue(status["imported"])
            self.assertEqual(status["matchedRunners"], 8)

            reused, reused_status = enricher.enrich(catalogue, book)
            self.assertEqual(reused_status["sourceMethod"], "Browser import")
            by_name = {normalize_runner_name(item["runnerName"]): item for item in reused["runners"]}
            self.assertEqual(by_name["golilogo"]["actualBox"], 5)
            self.assertEqual(by_name["aussietrickster"]["actualBox"], 6)

            cached = RecorderClient(Path(temporary)).get_racecard(market_context(catalogue))
            self.assertEqual(cached["raceNumber"], 9)

    def test_browser_import_rejects_the_wrong_race(self):
        catalogue, book = northam_market()
        catalogue["marketName"] = "R8 297m X65"
        with tempfile.TemporaryDirectory() as temporary:
            enricher = RecorderEnricher(Path(temporary))
            with self.assertRaises(RecorderUnavailable):
                enricher.import_html(catalogue, book, FIXTURE.read_text(encoding="utf-8"), SOURCE_URL)

    def test_automatic_fetch_uses_browser_compatible_headers(self):
        self.assertIn("Mozilla/5.0", BROWSER_HEADERS["User-Agent"])
        self.assertIn("text/html", BROWSER_HEADERS["Accept"])


if __name__ == "__main__":
    unittest.main()

