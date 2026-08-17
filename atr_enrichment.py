"""Conservative At The Races enrichment for British and Irish Betfair races."""

from __future__ import annotations

import copy
import http.cookiejar
import json
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from recorder_enrichment import normalize_runner_name, normalize_venue, slugify


SOURCE_NAME = "At The Races"
SOURCE_ROOT = "https://greyhounds.attheraces.com"
SUPPORTED_COUNTRIES = {"GB", "GBR", "UK", "IE", "IRL", "IRE"}
MIN_RUNNER_OVERLAP = 0.80
BROWSER_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    ),
}

VENUE_SLUGS = {
    "thevalley": "valley",
    "monmoregreen": "monmore",
    "star pelaw": "star-pelaw",
}


class AtrUnavailable(RuntimeError):
    """Raised when an ATR card cannot be located, parsed or matched safely."""


def normalize_atr_runner_name(value: Any) -> str:
    text = re.sub(r"\s*\([WM]\)\s*$", "", str(value or ""), flags=re.I)
    return normalize_runner_name(text)


def _number(value: Any, integer: bool = False) -> int | float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return None
    parsed = float(match.group(0))
    return int(parsed) if integer else parsed


def _clock_minutes(value: Any) -> int | None:
    match = re.search(r"(\d{1,2}):(\d{2})", str(value or ""))
    return int(match.group(1)) * 60 + int(match.group(2)) if match else None


def _clock_difference(left: int, right: int) -> int:
    difference = abs(left - right)
    return min(difference, 24 * 60 - difference)


def _last_sunday(year: int, month: int) -> datetime:
    if month == 12:
        first_next = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        first_next = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    last = first_next - timedelta(days=1)
    return last - timedelta(days=(last.weekday() - 6) % 7)


def _british_irish_local(start: datetime) -> datetime:
    # UK and Ireland currently share the same last-Sunday daylight-saving rules.
    dst_start = _last_sunday(start.year, 3).replace(hour=1)
    dst_end = _last_sunday(start.year, 10).replace(hour=1)
    offset = timedelta(hours=1) if dst_start <= start.astimezone(timezone.utc) < dst_end else timedelta(0)
    return start.astimezone(timezone(offset))


def _venue_slug(value: Any) -> str:
    normalized = normalize_venue(value)
    return VENUE_SLUGS.get(normalized, slugify(value))


def atr_market_context(catalogue: dict[str, Any]) -> dict[str, Any]:
    event = catalogue.get("event") or {}
    venue = event.get("venue") or event.get("name") or ""
    market_name = str(catalogue.get("marketName") or "")
    race_match = re.search(r"(?:^|\s)R(?:ace)?\s*(\d{1,2})(?:\s|$)", market_name, re.I)
    distance_match = re.search(r"\b(\d{3,4})m\b", market_name, re.I)
    try:
        start = datetime.fromisoformat(str(catalogue.get("marketStartTime")).replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        local_start = _british_irish_local(start)
    except (TypeError, ValueError):
        local_start = None

    country = str(event.get("countryCode") or "").upper()
    source_country = "IRE" if country in {"IE", "IRL", "IRE"} else "GB"
    return {
        "countryCode": country,
        "sourceCountry": source_country,
        "venue": venue,
        "venueNormalized": normalize_venue(venue),
        "venueSlug": _venue_slug(venue),
        "raceNumber": int(race_match.group(1)) if race_match else None,
        "distance": int(distance_match.group(1)) if distance_match else None,
        "date": local_start.date().isoformat() if local_start else None,
        "dateLabel": local_start.strftime("%d-%B-%Y") if local_start else None,
        "dateStamp": local_start.strftime("%Y%m%d") if local_start else None,
        "startMinutes": local_start.hour * 60 + local_start.minute if local_start else None,
        "startCode": local_start.strftime("%H%M") if local_start else None,
    }


class AtrHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.full_text: list[str] = []
        self.heading: list[str] = []
        self.heading_depth: int | None = None
        self.rows: list[dict[str, Any]] = []
        self.row: dict[str, Any] | None = None
        self.cell: list[str] | None = None
        self.cell_index: int | None = None
        self.runner_capture: list[str] | None = None
        self.runner_depth: int | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.depth += 1
        attributes = {key: value or "" for key, value in attrs}
        if tag == "h1" and self.heading_depth is None:
            self.heading_depth = self.depth
        if tag == "tr":
            self.row = {"cells": [], "runnerName": "", "runnerCell": None}
        if self.row is not None and tag in {"td", "th"}:
            self.cell = []
            self.row["cells"].append(self.cell)
            self.cell_index = len(self.row["cells"]) - 1
        href = attributes.get("href", "")
        if self.row is not None and tag == "a" and "/stats-hub/greyhound/" in href:
            self.runner_capture = []
            self.runner_depth = self.depth
            self.row["runnerCell"] = self.cell_index

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        self.full_text.append(text)
        if self.heading_depth is not None:
            self.heading.append(text)
        if self.cell is not None:
            self.cell.append(text)
        if self.runner_capture is not None:
            self.runner_capture.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self.runner_capture is not None and self.runner_depth == self.depth:
            raw = " ".join(self.runner_capture)
            # ATR places colour/sex in a second text node inside the same profile link.
            self.row["runnerName"] = re.sub(r"\([bdw]\s*-.*$", "", raw, flags=re.I).strip()
            self.runner_capture = None
            self.runner_depth = None
        if tag in {"td", "th"}:
            self.cell = None
            self.cell_index = None
        if tag == "tr" and self.row is not None:
            if self.row.get("runnerName"):
                self.rows.append(self.row)
            self.row = None
        if tag == "h1" and self.heading_depth == self.depth:
            self.heading_depth = None
        self.depth = max(0, self.depth - 1)


class AtrRaceLinkParser(HTMLParser):
    def __init__(self, context: dict[str, Any]) -> None:
        super().__init__(convert_charrefs=True)
        self.expected_path = (
            f"/racecard/{context['sourceCountry']}/{context['venueSlug']}/{context['dateLabel']}/"
        ).lower()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = dict(attrs).get("href") or ""
        absolute = urllib.parse.urljoin(SOURCE_ROOT, href)
        path = urllib.parse.urlparse(absolute).path
        if path.lower().startswith(self.expected_path) and re.search(r"/\d{4}/?$", path):
            if absolute not in self.links:
                self.links.append(absolute)


def parse_atr_html(html: str, source_url: str) -> dict[str, Any]:
    parser = AtrHtmlParser()
    parser.feed(html)
    heading = " ".join(parser.heading)
    heading_match = re.search(
        r"(.+?)\s+Greyhound Racecard for\s+(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4})\s+(\d{1,2}:\d{2})",
        heading,
        re.I,
    )
    if not heading_match:
        raise AtrUnavailable("ATR racecard heading could not be verified.")
    venue, date_text, start_text = heading_match.groups()
    parsed_date = None
    for pattern in ("%d %b %y", "%d %B %Y", "%d %b %Y"):
        try:
            parsed_date = datetime.strptime(date_text, pattern).date().isoformat()
            break
        except ValueError:
            continue

    page_text = " ".join(parser.full_text)
    race_match = re.search(r"\bRace\s+(\d{1,2})\b", page_text, re.I)
    distance_match = re.search(r"\b(\d{3,4})\s+metres\b", page_text, re.I)
    early_section = re.search(r"\bEarly Leaders\b(.*?)(?:\bHot Traps\b|$)", page_text, re.I)
    early_traps = []
    if early_section:
        for value in re.findall(r"\b([1-6])\b", early_section.group(1)):
            trap = int(value)
            if trap not in early_traps:
                early_traps.append(trap)

    runners = []
    seen = set()
    for row in parser.rows:
        cells = [" ".join(cell) for cell in row["cells"]]
        name = row["runnerName"]
        normalized = normalize_atr_runner_name(name)
        if not normalized or normalized in seen:
            continue
        runner_cell = row.get("runnerCell")
        if runner_cell is None or runner_cell < 1:
            continue
        trap = _number(cells[runner_cell - 1], integer=True)
        if trap is None or not 1 <= trap <= 6 or len(cells) <= runner_cell + 4:
            continue
        top_speed = _number(cells[runner_cell + 1], integer=True)
        if top_speed is None or not 0 <= top_speed <= 100 or "%" not in cells[runner_cell + 4]:
            continue
        seen.add(normalized)
        runner_text = cells[runner_cell]
        positions = re.findall(r"\b([1-6])(?:st|nd|rd|th)\b", runner_text, re.I)
        form = "".join(positions) or ("T" if re.search(r"\bT\b", runner_text) else None)
        comment = cells[runner_cell + 3] if len(cells) > runner_cell + 3 else None
        quick_form = _number(cells[runner_cell + 4], integer=True) if len(cells) > runner_cell + 4 else None
        scratched = bool(re.search(r"scratched|non[ -]?runner|withdrawn", " ".join(cells), re.I))
        runners.append({
            "name": name,
            "normalizedName": normalized,
            "actualBox": trap,
            "form": None if scratched else form,
            "comment": None if scratched else comment,
            "topSpeed": None if scratched else top_speed,
            "quickForm": None if scratched else quick_form,
            "earlyRank": early_traps.index(trap) + 1 if trap in early_traps and not scratched else None,
            "scratched": scratched,
        })

    race_number = int(race_match.group(1)) if race_match else None
    distance = int(distance_match.group(1)) if distance_match else None
    if not runners or race_number is None or distance is None or parsed_date is None:
        raise AtrUnavailable("ATR card did not contain a complete, usable runner table.")
    return {
        "venue": venue.strip(),
        "date": parsed_date,
        "raceNumber": race_number,
        "distance": distance,
        "startText": start_text,
        "startMinutes": _clock_minutes(start_text),
        "sourceUrl": source_url,
        "runners": runners,
    }


class AtrClient:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = Path(cache_dir)
        self.lock = threading.RLock()
        self.memory: dict[str, dict[str, Any]] = {}
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

    @staticmethod
    def race_url(context: dict[str, Any]) -> str:
        return (
            f"{SOURCE_ROOT}/racecard/{context['sourceCountry']}/{context['venueSlug']}/"
            f"{context['dateLabel']}/{context['startCode']}"
        )

    @staticmethod
    def meeting_url(context: dict[str, Any]) -> str:
        return (
            f"{SOURCE_ROOT}/racecard/{context['sourceCountry']}/{context['venueSlug']}/"
            f"{context['dateLabel']}"
        )

    @staticmethod
    def _race_key(context: dict[str, Any]) -> str:
        return f"{context['sourceCountry'].lower()}-{context['venueSlug']}-{context['dateStamp']}-r{context['raceNumber']}"

    def get_racecard(self, context: dict[str, Any]) -> dict[str, Any]:
        key = self._race_key(context)
        with self.lock:
            if key in self.memory:
                return copy.deepcopy(self.memory[key])
            cached = self._read_cache(f"race-{key}.json")
            if cached:
                self.memory[key] = cached
                return copy.deepcopy(cached)

        source_url = self._race_url(context)
        card = parse_atr_html(self._fetch_text(source_url), source_url)
        card["fetchedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        self.save_racecard(context, card)
        return copy.deepcopy(card)

    def _race_url(self, context: dict[str, Any]) -> str:
        meeting_key = f"{context['sourceCountry'].lower()}-{context['venueSlug']}-{context['dateStamp']}"
        links = self._read_cache(f"meeting-{meeting_key}.json")
        if not isinstance(links, list):
            parser = AtrRaceLinkParser(context)
            try:
                parser.feed(self._fetch_text(self.meeting_url(context)))
            except AtrUnavailable:
                return self.race_url(context)
            links = parser.links
            if links:
                self._write_cache(f"meeting-{meeting_key}.json", links)
        race_index = int(context["raceNumber"]) - 1
        if isinstance(links, list) and 0 <= race_index < len(links):
            return links[race_index]
        return self.race_url(context)

    def save_racecard(self, context: dict[str, Any], card: dict[str, Any]) -> None:
        key = self._race_key(context)
        with self.lock:
            self._write_cache(f"race-{key}.json", card)
            self.memory[key] = copy.deepcopy(card)

    def _fetch_text(self, url: str) -> str:
        request = urllib.request.Request(url, headers={**BROWSER_HEADERS, "Referer": f"{SOURCE_ROOT}/racecards/today"})
        try:
            with self.opener.open(request, timeout=15) as response:
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            raise AtrUnavailable(
                f"ATR source unavailable: HTTP {error.code}. Import the racecard page to add form data."
            ) from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise AtrUnavailable(f"ATR source unavailable: {error}") from error

    def _read_cache(self, name: str) -> Any:
        try:
            return json.loads((self.cache_dir / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_cache(self, name: str, value: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self.cache_dir / name
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)


class AtrEnricher:
    def __init__(self, cache_dir: Path) -> None:
        self.client = AtrClient(cache_dir)
        self.lock = threading.RLock()
        self.results: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}

    def enrich(self, catalogue: dict[str, Any] | None, book: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        if not catalogue:
            return catalogue, self._status("unavailable", "Betfair catalogue metadata is unavailable.")
        context = atr_market_context(catalogue)
        if context["countryCode"] not in SUPPORTED_COUNTRIES:
            return catalogue, self._status("not-applicable", "ATR enrichment is limited to British and Irish races.")
        required = ("venueSlug", "raceNumber", "distance", "dateStamp", "startCode")
        if any(not context.get(key) for key in required):
            return catalogue, self._status("unavailable", "Betfair race metadata was incomplete; ATR lookup was skipped.", context)

        market_key = str(catalogue.get("marketId") or "-")
        with self.lock:
            if market_key in self.results:
                enriched, status = self.results[market_key]
                return copy.deepcopy(enriched), copy.deepcopy(status)
        try:
            card = self.client.get_racecard(context)
            enriched, status = match_atr_racecard(catalogue, book, context, card)
        except Exception as error:
            reason = str(error) if isinstance(error, AtrUnavailable) else "ATR enrichment failed safely."
            enriched, status = catalogue, self._status("unavailable", reason, context)
        with self.lock:
            self.results[market_key] = (copy.deepcopy(enriched), copy.deepcopy(status))
        return enriched, status

    def import_html(
        self,
        catalogue: dict[str, Any] | None,
        book: dict[str, Any] | None,
        html: str,
        source_url: str | None = None,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        if not catalogue or not book:
            raise AtrUnavailable("Load the selected Betfair race before importing its form.")
        context = atr_market_context(catalogue)
        if context["countryCode"] not in SUPPORTED_COUNTRIES:
            raise AtrUnavailable("ATR imports are limited to British and Irish races.")
        if not html.strip() or "<" not in html:
            raise AtrUnavailable("Copy the complete ATR racecard webpage, then paste it here.")
        attribution_url = str(source_url or self.client.race_url(context))
        card = parse_atr_html(html, attribution_url)
        card["fetchedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        enriched, status = match_atr_racecard(catalogue, book, context, card)
        status["imported"] = True
        status["sourceMethod"] = "Browser import"
        self.client.save_racecard(context, card)
        market_key = str(catalogue.get("marketId") or "-")
        with self.lock:
            self.results[market_key] = (copy.deepcopy(enriched), copy.deepcopy(status))
        return enriched, status

    @staticmethod
    def _status(status: str, reason: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        result = {"status": status, "source": SOURCE_NAME, "reason": reason, "sourceKey": "atr"}
        if context and all(context.get(key) for key in ("venueSlug", "dateLabel", "startCode")):
            result["meetingUrl"] = AtrClient.race_url(context)
        return result


def _matching_venue(value: Any) -> str:
    aliases = {"thevalley": "valley", "monmoregreen": "monmore"}
    normalized = normalize_venue(value)
    return aliases.get(normalized, normalized)


def match_atr_racecard(
    catalogue: dict[str, Any],
    book: dict[str, Any],
    context: dict[str, Any],
    card: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    checks = {
        "venue": _matching_venue(card.get("venue")) == _matching_venue(context.get("venue")),
        "date": card.get("date") == context.get("date"),
        "raceNumber": card.get("raceNumber") == context.get("raceNumber"),
        "distance": card.get("distance") == context.get("distance"),
    }
    if not all(checks.values()):
        failed = ", ".join(key for key, passed in checks.items() if not passed)
        raise AtrUnavailable(f"ATR race identity did not match Betfair ({failed}).")

    start_difference = None
    if context.get("startMinutes") is not None and card.get("startMinutes") is not None:
        start_difference = _clock_difference(context["startMinutes"], card["startMinutes"])

    book_status = {str(item.get("selectionId")): item.get("status") for item in book.get("runners", [])}
    betfair_active = [
        runner for runner in catalogue.get("runners", [])
        if book_status.get(str(runner.get("selectionId")), "ACTIVE") == "ACTIVE"
    ]
    atr_active = [runner for runner in card.get("runners", []) if not runner.get("scratched")]
    atr_by_name = {runner["normalizedName"]: runner for runner in atr_active}
    matches = {
        normalize_atr_runner_name(runner.get("runnerName")): atr_by_name[normalize_atr_runner_name(runner.get("runnerName"))]
        for runner in betfair_active
        if normalize_atr_runner_name(runner.get("runnerName")) in atr_by_name
    }
    denominator = max(len(betfair_active), len(atr_active), 1)
    overlap = len(matches) / denominator
    minimum_count = min(3, len(betfair_active))
    if overlap < MIN_RUNNER_OVERLAP or len(matches) < minimum_count:
        raise AtrUnavailable(f"ATR runner-name overlap was too low ({len(matches)}/{denominator}).")

    schedule_changed = start_difference is not None and start_difference > 15
    if schedule_changed and (overlap < 0.8 or len(matches) < min(4, len(betfair_active))):
        raise AtrUnavailable(
            "ATR and Betfair start times differed by more than 15 minutes, and runner overlap was not strong enough."
        )

    enriched = copy.deepcopy(catalogue)
    for runner in enriched.get("runners", []):
        match = matches.get(normalize_atr_runner_name(runner.get("runnerName")))
        if not match:
            continue
        runner["actualBox"] = match.get("actualBox")
        form_data = {
            "actualBox": match.get("actualBox"),
            "earlySpeed": None,
            "earlyRank": match.get("earlyRank"),
            "rating": match.get("topSpeed"),
            "ratingLabel": "Top Speed",
            "form": match.get("form"),
            "comment": match.get("comment"),
            "quickForm": match.get("quickForm"),
            "ourPrice": None,
            "source": {"name": SOURCE_NAME, "url": card.get("sourceUrl")},
        }
        runner["atr"] = form_data
        runner["formData"] = form_data

    unmatched_betfair = [
        runner.get("runnerName") for runner in betfair_active
        if normalize_atr_runner_name(runner.get("runnerName")) not in matches
    ]
    betfair_names = {normalize_atr_runner_name(runner.get("runnerName")) for runner in betfair_active}
    unmatched_atr = [runner.get("name") for runner in atr_active if runner["normalizedName"] not in betfair_names]
    status = {
        "status": "matched" if overlap == 1 else "partial",
        "source": SOURCE_NAME,
        "sourceKey": "atr",
        "sourceUrl": card.get("sourceUrl"),
        "confidence": round((0.8 if schedule_changed else 0.85) + 0.15 * overlap, 3),
        "matchedRunners": len(matches),
        "betfairActiveRunners": len(betfair_active),
        "sourceActiveRunners": len(atr_active),
        "runnerOverlap": round(overlap, 3),
        "startDifferenceMinutes": start_difference,
        "scheduleChanged": schedule_changed,
        "unmatchedBetfair": unmatched_betfair,
        "unmatchedSource": unmatched_atr,
        "fetchedAt": card.get("fetchedAt"),
    }
    return enriched, status

