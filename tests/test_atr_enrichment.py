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
    parse_atr_text,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "atr_dunstall_r6.html"
SHEFFIELD_RENDERED = ROOT / "tests" / "fixtures" / "atr_sheffield_rendered.html"
SHEFFIELD_TEXT = ROOT / "tests" / "fixtures" / "atr_sheffield_flattened.txt"
SOURCE_URL = "https://greyhounds.attheraces.com/racecard/GB/dunstall-park/17-August-2026/1226"
SHEFFIELD_URL = "https://greyhounds.attheraces.com/racecard/GB/sheffield/18-August-2026/1407"


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


def sheffield_market():
    names = ["Diamond Santa", "Blue Gate In", "Da Safety Net", "Dingle Bottom (M)", "Blake Delight (W)"]
    runners = [
        {"selectionId": 3000 + index, "runnerName": name, "sortPriority": index}
        for index, name in enumerate(names, start=1)
    ]
    catalogue = {
        "marketId": "1.sheffield-r12",
        "marketName": "R12 500m A3",
        "marketStartTime": "2026-08-18T13:07:00Z",
        "event": {"name": "Sheffield", "venue": "Sheffield", "countryCode": "GB"},
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

    def test_parses_rendered_role_rows_without_a_page_race_number(self):
        catalogue, book = sheffield_market()
        context = atr_market_context(catalogue)
        card = parse_atr_html(SHEFFIELD_RENDERED.read_text(encoding="utf-8"), SHEFFIELD_URL, context)
        enriched, status = match_atr_racecard(catalogue, book, context, card)
        self.assertEqual(status["matchedRunners"], 5)
        self.assertEqual(card["raceNumber"], 12)
        by_name = {runner["normalizedName"]: runner for runner in card["runners"]}
        self.assertEqual(by_name["dasafetynet"]["earlyRank"], 1)
        self.assertEqual(by_name["bluegatein"]["earlyRank"], 2)
        self.assertEqual(enriched["runners"][2]["formData"]["rating"], 100)

    def test_parses_flattened_sheffield_text_using_selected_market_identity(self):
        catalogue, book = sheffield_market()
        context = atr_market_context(catalogue)
        card = parse_atr_text(
            SHEFFIELD_TEXT.read_text(encoding="utf-8"),
            SHEFFIELD_URL,
            context,
            [runner["runnerName"] for runner in catalogue["runners"]],
        )
        enriched, status = match_atr_racecard(catalogue, book, context, card)
        self.assertEqual(status["runnerOverlap"], 1.0)
        self.assertEqual(card["runners"][0]["comment"], "Needs to improve at the boxes.")
        self.assertEqual(card["runners"][2]["earlyRank"], 1)
        self.assertEqual(enriched["runners"][4]["actualBox"], 6)

    def test_flattened_text_rejects_wrong_url_or_low_runner_overlap(self):
        catalogue, book = sheffield_market()
        context = atr_market_context(catalogue)
        text = SHEFFIELD_TEXT.read_text(encoding="utf-8")
        with self.assertRaises(AtrUnavailable):
            parse_atr_text(text, SHEFFIELD_URL.replace("1407", "1351"), context, [])
        catalogue["runners"] = catalogue["runners"][:2] + [
            {"selectionId": 3999, "runnerName": "Different Runner", "sortPriority": 3}
        ]
        book["runners"] = [
            {"selectionId": runner["selectionId"], "status": "ACTIVE"}
            for runner in catalogue["runners"]
        ]
        with tempfile.TemporaryDirectory() as temporary:
            enricher = AtrEnricher(Path(temporary))
            with self.assertRaises(AtrUnavailable):
                enricher.import_html(catalogue, book, text, SHEFFIELD_URL)


class StubAtrClient(AtrClient):
    def __init__(self, cache_dir, html, browser_fetcher=None):
        super().__init__(cache_dir, browser_fetcher=browser_fetcher)
        self.html = html
        self.fetches = []

    def _fetch_text(self, url):
        self.fetches.append(url)
        return self.html


class StubBrowserFetcher:
    def __init__(self, html):
        self.html = html
        self.fetches = []

    def fetch(self, url):
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
            self.assertEqual(reused_status["sourceMethod"], "Copied webpage")
            self.assertEqual(reused["runners"][0]["formData"]["rating"], 100)

    def test_uses_hidden_browser_after_http_shell_then_reuses_cache(self):
        catalogue, _book = sheffield_market()
        context = atr_market_context(catalogue)
        browser = StubBrowserFetcher(SHEFFIELD_RENDERED.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            first = StubAtrClient(Path(temporary), "<html><body>ATR app shell</body></html>", browser)
            card = first.get_racecard(context)
            self.assertEqual(card["sourceMethod"], "Headless browser")
            self.assertEqual(len(browser.fetches), 1)
            first.get_racecard(context)
            self.assertEqual(len(browser.fetches), 1)

            second_browser = StubBrowserFetcher("should not be used")
            second = StubAtrClient(Path(temporary), "should not be used", second_browser)
            self.assertEqual(second.get_racecard(context)["sourceMethod"], "Headless browser")
            self.assertEqual(second.fetches, [])
            self.assertEqual(second_browser.fetches, [])


if __name__ == "__main__":
    unittest.main()

