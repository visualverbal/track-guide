"""Conservative Greyhound Recorder enrichment for Australian Betfair races."""

from __future__ import annotations

import copy
import http.cookiejar
import json
import re
import threading
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SOURCE_NAME = "Greyhound Recorder"
SOURCE_ROOT = "https://www.thegreyhoundrecorder.com.au"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/140.0.0.0 Safari/537.36"
)
BROWSER_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-AU,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": USER_AGENT,
}
MIN_RUNNER_OVERLAP = 0.80

VENUE_TIMEZONES = {
    "northam": "Australia/Perth",
    "mandurah": "Australia/Perth",
    "cannington": "Australia/Perth",
    "darwin": "Australia/Darwin",
    "anglepark": "Australia/Adelaide",
    "mountgambier": "Australia/Adelaide",
    "murraybridge": "Australia/Adelaide",
    "capalaba": "Australia/Brisbane",
    "rockhampton": "Australia/Brisbane",
    "townsville": "Australia/Brisbane",
    "launceston": "Australia/Hobart",
}

FALLBACK_TIMEZONE_MINUTES = {
    "Australia/Perth": 8 * 60,
    "Australia/Darwin": 9 * 60 + 30,
    "Australia/Brisbane": 10 * 60,
    "Australia/Adelaide": 9 * 60 + 30,
    "Australia/Sydney": 10 * 60,
    "Australia/Melbourne": 10 * 60,
    "Australia/Hobart": 10 * 60,
}
DST_TIMEZONES = {"Australia/Adelaide", "Australia/Sydney", "Australia/Melbourne", "Australia/Hobart"}


class RecorderUnavailable(RuntimeError):
    """Raised when a Recorder page cannot be located or parsed safely."""


def normalize_runner_name(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"^\s*\d+\s*[.\-:]\s*", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def normalize_venue(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"\b(greyhounds?|dogs?|racing)\b", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def slugify(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"\b(greyhounds?|dogs?|racing)\b", "", text)
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _number(value: Any, integer: bool = False) -> int | float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return None
    parsed = float(match.group(0))
    return int(parsed) if integer else parsed


def _clock_minutes(value: Any) -> int | None:
    match = re.search(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", str(value or ""), re.I)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    meridiem = (match.group(3) or "").upper()
    if meridiem == "PM" and hour != 12:
        hour += 12
    if meridiem == "AM" and hour == 12:
        hour = 0
    return hour * 60 + minute


def _clock_difference(left: int, right: int) -> int:
    difference = abs(left - right)
    return min(difference, 24 * 60 - difference)


def _first_sunday(year: int, month: int) -> datetime:
    first = datetime(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7)


def _fallback_timezone(timezone_name: str, start: datetime) -> timezone:
    minutes = FALLBACK_TIMEZONE_MINUTES.get(timezone_name, 10 * 60)
    if timezone_name in DST_TIMEZONES:
        date = start.date()
        dst_start = _first_sunday(date.year, 10).date()
        dst_end = _first_sunday(date.year, 4).date()
        if date >= dst_start or date < dst_end:
            minutes += 60
    return timezone(timedelta(minutes=minutes))


def market_context(catalogue: dict[str, Any]) -> dict[str, Any]:
    event = catalogue.get("event") or {}
    venue = event.get("venue") or event.get("name") or ""
    name = str(catalogue.get("marketName") or "")
    race_match = re.search(r"(?:^|\s)R(?:ace)?\s*(\d{1,2})(?:\s|$)", name, re.I)
    distance_match = re.search(r"\b(\d{3,4})m\b", name, re.I)
    start_text = catalogue.get("marketStartTime")
    try:
        start = datetime.fromisoformat(str(start_text).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        start = None

    venue_key = normalize_venue(venue)
    timezone_name = VENUE_TIMEZONES.get(venue_key) or event.get("timezone") or "Australia/Sydney"
    local_start = start
    if start:
        try:
            local_start = start.astimezone(ZoneInfo(str(timezone_name)))
        except (ZoneInfoNotFoundError, ValueError):
            local_start = start.astimezone(_fallback_timezone(str(timezone_name), start))

    return {
        "countryCode": str(event.get("countryCode") or "").upper(),
        "venue": venue,
        "venueNormalized": venue_key,
        "venueSlug": slugify(venue),
        "raceNumber": int(race_match.group(1)) if race_match else None,
        "distance": int(distance_match.group(1)) if distance_match else None,
        "date": local_start.date().isoformat() if local_start else None,
        "dateStamp": local_start.strftime("%Y%m%d") if local_start else None,
        "startMinutes": local_start.hour * 60 + local_start.minute if local_start else None,
    }


class RecorderHtmlParser(HTMLParser):
    HEADER_CLASSES = {
        "form-guide-meeting__heading": "meetingHeading",
        "meeting-event__header-race": "raceText",
        "meeting-event__header-name": "raceName",
        "meeting-event__header-distance": "distanceText",
        "meeting-event__header-time": "startText",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.captures: list[dict[str, Any]] = []
        self.headers: dict[str, str] = {}
        self.links: list[tuple[int, str]] = []
        self.rows: list[dict[str, Any]] = []
        self.row: dict[str, Any] | None = None
        self.current_cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.depth += 1
        attributes = {key: value or "" for key, value in attrs}
        classes = set(attributes.get("class", "").split())

        if tag == "a" and attributes.get("href"):
            analytics = attributes.get("data-analytics", "")
            race_match = re.search(r"Race\s+(\d+)", analytics, re.I)
            href_match = re.search(r"race-(\d+)/long-form/?$", attributes["href"], re.I)
            match = race_match or href_match
            if match and "/form-guides/" in attributes["href"]:
                self.links.append((int(match.group(1)), urllib.parse.urljoin(SOURCE_ROOT, attributes["href"])))

        if tag == "tr" and "form-guide-long-form-table-selection" in classes:
            self.row = {
                "cells": [],
                "rug": None,
                "name": "",
                "boxText": "",
                "scratchedClass": "form-guide-long-form-table-selection--scratched" in classes,
            }

        if self.row is not None and tag == "td":
            self.current_cell = []
            self.row["cells"].append(self.current_cell)

        if self.row is not None and tag == "img":
            rug_match = re.fullmatch(r"Rug\s+(\d+)", attributes.get("alt", ""), re.I)
            if rug_match:
                self.row["rug"] = int(rug_match.group(1))

        capture_key = None
        for class_name, key in self.HEADER_CLASSES.items():
            if class_name in classes:
                capture_key = key
                break
        if self.row is not None and "form-guide-long-form-table-selection__name" in classes:
            capture_key = "runnerName"
        elif self.row is not None and "form-guide-long-form-table-selection__box" in classes:
            capture_key = "boxText"
        if capture_key:
            self.captures.append({"tag": tag, "key": capture_key, "depth": self.depth, "text": []})

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_data(self, data: str) -> None:
        if self.current_cell is not None:
            self.current_cell.append(data)
        for capture in self.captures:
            capture["text"].append(data)

    def handle_endtag(self, tag: str) -> None:
        completed = [item for item in self.captures if item["tag"] == tag and item["depth"] == self.depth]
        for capture in completed:
            text = " ".join("".join(capture["text"]).split())
            if capture["key"] == "runnerName" and self.row is not None:
                self.row["name"] = text
            elif capture["key"] == "boxText" and self.row is not None:
                self.row["boxText"] = text
            else:
                self.headers[capture["key"]] = text
            self.captures.remove(capture)

        if tag == "td" and self.current_cell is not None:
            self.current_cell = None
        if tag == "tr" and self.row is not None:
            self.rows.append(self.row)
            self.row = None
            self.current_cell = None
        self.depth = max(0, self.depth - 1)


def parse_recorder_html(html: str, source_url: str) -> dict[str, Any]:
    parser = RecorderHtmlParser()
    parser.feed(html)
    heading = parser.headers.get("meetingHeading", "")
    venue_match = re.match(r"(.+?)\s+Form Guide", heading, re.I)
    date_match = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})", heading)
    parsed_date = None
    if date_match:
        try:
            parsed_date = datetime.strptime(" ".join(date_match.groups()), "%d %b %Y").date().isoformat()
        except ValueError:
            try:
                parsed_date = datetime.strptime(" ".join(date_match.groups()), "%d %B %Y").date().isoformat()
            except ValueError:
                pass

    runners = []
    seen = set()
    for row in parser.rows:
        cells = [" ".join("".join(cell).split()) for cell in row["cells"]]
        name = row.get("name") or (cells[0] if cells else "")
        normalized = normalize_runner_name(name)
        if not normalized or normalized in seen or "vacantbox" in normalized:
            continue
        seen.add(normalized)
        scratched = bool(row.get("scratchedClass")) or any("scratched" in cell.lower() for cell in cells)
        rug = row.get("rug")
        box_match = re.search(r"Box\s+(\d+)", row.get("boxText") or "", re.I)
        actual_box = int(box_match.group(1)) if box_match else (rug if isinstance(rug, int) and rug <= 10 else None)
        runners.append({
            "name": name,
            "normalizedName": normalized,
            "rug": rug,
            "actualBox": actual_box,
            "form": None if scratched or len(cells) < 2 else cells[1],
            "comment": None if scratched or len(cells) < 3 else cells[2],
            "earlySpeed": None if scratched or len(cells) < 4 else _number(cells[3], integer=True),
            "rating": None if scratched or len(cells) < 5 else _number(cells[4], integer=True),
            "ourPrice": None if scratched or len(cells) < 6 else _number(cells[5]),
            "scratched": scratched,
        })

    race_number = _number(parser.headers.get("raceText"), integer=True)
    distance = _number(parser.headers.get("distanceText"), integer=True)
    if not runners or race_number is None:
        raise RecorderUnavailable("Recorder long-form card did not contain a usable runner table.")
    return {
        "venue": venue_match.group(1).strip() if venue_match else "",
        "date": parsed_date,
        "raceNumber": race_number,
        "raceName": parser.headers.get("raceName", ""),
        "distance": distance,
        "startText": parser.headers.get("startText", ""),
        "startMinutes": _clock_minutes(parser.headers.get("startText")),
        "sourceUrl": source_url,
        "runners": runners,
    }


class RecorderClient:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = Path(cache_dir)
        self.lock = threading.RLock()
        self.memory: dict[str, dict[str, Any]] = {}
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
        )

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
        card = parse_recorder_html(self._fetch_text(source_url), source_url)
        card["fetchedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        with self.lock:
            self._write_cache(f"race-{key}.json", card)
            self.memory[key] = card
        return copy.deepcopy(card)

    def save_racecard(self, context: dict[str, Any], card: dict[str, Any]) -> None:
        key = self._race_key(context)
        with self.lock:
            self._write_cache(f"race-{key}.json", card)
            self.memory[key] = copy.deepcopy(card)

    @staticmethod
    def _race_key(context: dict[str, Any]) -> str:
        return f"{context['venueSlug']}-{context['dateStamp']}-r{context['raceNumber']}"

    @staticmethod
    def meeting_url(context: dict[str, Any]) -> str:
        meeting_key = f"{context['venueSlug']}-{context['dateStamp']}"
        return f"{SOURCE_ROOT}/form-guides/{meeting_key}/fields/"

    def _race_url(self, context: dict[str, Any]) -> str:
        meeting_key = f"{context['venueSlug']}-{context['dateStamp']}"
        links = self._read_cache(f"meeting-{meeting_key}.json") or {}
        race_key = str(context["raceNumber"])
        if race_key not in links:
            fields_url = self.meeting_url(context)
            parser = RecorderHtmlParser()
            parser.feed(self._fetch_text(fields_url))
            meeting_path = f"/form-guides/{meeting_key}/"
            links = {
                str(number): url
                for number, url in parser.links
                if meeting_path in urllib.parse.urlparse(url).path
            }
            if not links:
                raise RecorderUnavailable("Recorder meeting page did not expose long-form race links.")
            self._write_cache(f"meeting-{meeting_key}.json", links)
        source_url = links.get(race_key)
        if not source_url:
            raise RecorderUnavailable(f"Recorder did not list race {race_key} for this meeting.")
        return source_url

    def _fetch_text(self, url: str) -> str:
        headers = {**BROWSER_HEADERS, "Referer": f"{SOURCE_ROOT}/form-guides/"}
        request = urllib.request.Request(url, headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if error.code == 403:
                raise RecorderUnavailable(
                    "Recorder blocked the automatic request (HTTP 403). Import the long-form page to add form data."
                ) from error
            raise RecorderUnavailable(f"Recorder source unavailable: HTTP {error.code}.") from error
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            raise RecorderUnavailable(f"Recorder source unavailable: {error}") from error

    def _read_cache(self, name: str) -> dict[str, Any] | None:
        path = self.cache_dir / name
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_cache(self, name: str, value: dict[str, Any]) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self.cache_dir / name
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)


class RecorderEnricher:
    def __init__(self, cache_dir: Path) -> None:
        self.client = RecorderClient(cache_dir)
        self.lock = threading.RLock()
        self.results: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}

    def enrich(self, catalogue: dict[str, Any] | None, book: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        if not catalogue:
            return catalogue, self._status("unavailable", "Betfair catalogue metadata is unavailable.")
        context = market_context(catalogue)
        if context["countryCode"] != "AU":
            return catalogue, self._status("not-applicable", "Recorder enrichment is currently limited to Australian races.")
        required = ("venueSlug", "raceNumber", "distance", "dateStamp")
        if any(not context.get(key) for key in required):
            return catalogue, self._status("unavailable", "Betfair race metadata was incomplete; Recorder lookup was skipped.", context)

        market_key = str(catalogue.get("marketId") or "-")
        with self.lock:
            if market_key in self.results:
                enriched, status = self.results[market_key]
                return copy.deepcopy(enriched), copy.deepcopy(status)

        try:
            card = self.client.get_racecard(context)
            enriched, status = match_racecard(catalogue, book, context, card)
        except Exception as error:
            reason = str(error) if isinstance(error, RecorderUnavailable) else "Recorder enrichment failed safely."
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
            raise RecorderUnavailable("Load the selected Betfair race before importing its form.")
        context = market_context(catalogue)
        if context["countryCode"] != "AU":
            raise RecorderUnavailable("Recorder imports are limited to Australian races.")
        if not html.strip() or "<" not in html:
            raise RecorderUnavailable("Copy the complete Recorder long-form webpage, then paste it here.")

        attribution_url = str(source_url or self.client.meeting_url(context))
        card = parse_recorder_html(html, attribution_url)
        card["fetchedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        enriched, status = match_racecard(catalogue, book, context, card)
        status["imported"] = True
        status["sourceMethod"] = "Browser import"

        self.client.save_racecard(context, card)
        market_key = str(catalogue.get("marketId") or "-")
        with self.lock:
            self.results[market_key] = (copy.deepcopy(enriched), copy.deepcopy(status))
        return enriched, status

    @staticmethod
    def _status(status: str, reason: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        result = {"status": status, "source": SOURCE_NAME, "reason": reason}
        if context and context.get("venueSlug") and context.get("dateStamp"):
            result["meetingUrl"] = RecorderClient.meeting_url(context)
        return result


def match_racecard(
    catalogue: dict[str, Any],
    book: dict[str, Any],
    context: dict[str, Any],
    card: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    checks = {
        "venue": normalize_venue(card.get("venue")) == context.get("venueNormalized"),
        "date": card.get("date") == context.get("date"),
        "raceNumber": card.get("raceNumber") == context.get("raceNumber"),
        "distance": card.get("distance") == context.get("distance"),
    }
    if not all(checks.values()):
        failed = ", ".join(key for key, passed in checks.items() if not passed)
        raise RecorderUnavailable(f"Recorder race identity did not match Betfair ({failed}).")

    if context.get("startMinutes") is not None and card.get("startMinutes") is not None:
        start_difference = _clock_difference(context["startMinutes"], card["startMinutes"])
        if start_difference > 15:
            raise RecorderUnavailable("Recorder and Betfair start times differed by more than 15 minutes.")
    else:
        start_difference = None

    book_status = {str(item.get("selectionId")): item.get("status") for item in book.get("runners", [])}
    betfair_active = [
        runner for runner in catalogue.get("runners", [])
        if book_status.get(str(runner.get("selectionId")), "ACTIVE") == "ACTIVE"
    ]
    recorder_active = [runner for runner in card.get("runners", []) if not runner.get("scratched")]
    recorder_by_name = {runner["normalizedName"]: runner for runner in recorder_active}
    matches = {
        normalize_runner_name(runner.get("runnerName")): recorder_by_name[normalize_runner_name(runner.get("runnerName"))]
        for runner in betfair_active
        if normalize_runner_name(runner.get("runnerName")) in recorder_by_name
    }
    denominator = max(len(betfair_active), len(recorder_active), 1)
    overlap = len(matches) / denominator
    minimum_count = min(3, len(betfair_active))
    if overlap < MIN_RUNNER_OVERLAP or len(matches) < minimum_count:
        raise RecorderUnavailable(f"Recorder runner-name overlap was too low ({len(matches)}/{denominator}).")

    enriched = copy.deepcopy(catalogue)
    for runner in enriched.get("runners", []):
        match = matches.get(normalize_runner_name(runner.get("runnerName")))
        if not match:
            continue
        runner["actualBox"] = match.get("actualBox")
        runner["recorder"] = {
            "rug": match.get("rug"),
            "actualBox": match.get("actualBox"),
            "earlySpeed": match.get("earlySpeed"),
            "rating": match.get("rating"),
            "form": match.get("form"),
            "comment": match.get("comment"),
            "ourPrice": match.get("ourPrice"),
            "source": {"name": SOURCE_NAME, "url": card.get("sourceUrl")},
        }

    unmatched_betfair = [
        runner.get("runnerName") for runner in betfair_active
        if normalize_runner_name(runner.get("runnerName")) not in matches
    ]
    betfair_names = {normalize_runner_name(runner.get("runnerName")) for runner in betfair_active}
    unmatched_recorder = [runner.get("name") for runner in recorder_active if runner["normalizedName"] not in betfair_names]
    status = {
        "status": "matched" if overlap == 1 else "partial",
        "source": SOURCE_NAME,
        "sourceUrl": card.get("sourceUrl"),
        "confidence": round(0.85 + 0.15 * overlap, 3),
        "matchedRunners": len(matches),
        "betfairActiveRunners": len(betfair_active),
        "recorderActiveRunners": len(recorder_active),
        "runnerOverlap": round(overlap, 3),
        "startDifferenceMinutes": start_difference,
        "unmatchedBetfair": unmatched_betfair,
        "unmatchedRecorder": unmatched_recorder,
        "fetchedAt": card.get("fetchedAt"),
    }
    return enriched, status

