#!/usr/bin/env python3
"""Local, read-only bridge between the Track Guide and Betfair Exchange."""

from __future__ import annotations

import argparse
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
DEFAULT_PORT = 8787
EVENT_TYPE_GREYHOUNDS = "4339"
LOGIN_ENDPOINTS = {
    "au": "https://identitysso.betfair.com.au/api/login",
    "global": "https://identitysso.betfair.com/api/login",
}
LOGOUT_ENDPOINTS = {
    "au": "https://identitysso.betfair.com.au/api/logout",
    "global": "https://identitysso.betfair.com/api/logout",
}
BETTING_ENDPOINTS = {
    "au": "https://api-au.betfair.com/exchange/betting/json-rpc/v1",
    "global": "https://api.betfair.com/exchange/betting/json-rpc/v1",
}
ALLOWED_ORIGINS = {
    "https://visualverbal.github.io",
    "http://127.0.0.1:8787",
    "http://localhost:8787",
}


def utc_text(value: datetime | None = None) -> str:
    current = value or datetime.now(timezone.utc)
    return current.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class ConnectorError(RuntimeError):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


class BetfairSession:
    def __init__(self, demo: bool = False) -> None:
        self.app_key = "demo" if demo else ""
        self.token = "demo" if demo else ""
        self.jurisdiction = "au"
        self.demo = demo
        self.lock = threading.RLock()
        self.catalogue: dict[str, dict[str, Any]] = {}

    @property
    def connected(self) -> bool:
        return bool(self.app_key and self.token)

    def login(self, app_key: str, username: str, password: str, jurisdiction: str) -> None:
        if self.demo:
            return
        if not app_key or not username or not password:
            raise ConnectorError("App key, username and password are required.", 400)
        if jurisdiction not in LOGIN_ENDPOINTS:
            raise ConnectorError("Unknown Betfair jurisdiction.", 400)

        body = urllib.parse.urlencode({"username": username, "password": password}).encode("utf-8")
        request = urllib.request.Request(
            LOGIN_ENDPOINTS[jurisdiction],
            data=body,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Application": app_key,
                "User-Agent": "TrackGuide/1.0",
            },
            method="POST",
        )
        payload = self._open_json(request)
        status = str(payload.get("status") or payload.get("loginStatus") or "").upper()
        token = payload.get("token") or payload.get("sessionToken")
        if status != "SUCCESS" or not token:
            reason = payload.get("error") or status or "Login failed"
            raise ConnectorError(f"Betfair login failed: {reason}", 401)
        with self.lock:
            self.app_key = app_key
            self.token = str(token)
            self.jurisdiction = jurisdiction
            self.catalogue.clear()

    def logout(self) -> None:
        if self.connected and not self.demo:
            request = urllib.request.Request(
                LOGOUT_ENDPOINTS[self.jurisdiction],
                headers=self._headers(),
                method="POST",
            )
            try:
                self._open_json(request)
            except ConnectorError:
                pass
        with self.lock:
            if not self.demo:
                self.app_key = ""
                self.token = ""
            self.catalogue.clear()

    def status(self) -> dict[str, Any]:
        return {
            "connected": self.connected,
            "demo": self.demo,
            "jurisdiction": self.jurisdiction if self.connected else None,
            "fetchedAt": utc_text(),
        }

    def markets(self, minutes: int) -> dict[str, Any]:
        self._require_connection()
        if self.demo:
            markets = self._demo_markets()
        else:
            now = datetime.now(timezone.utc)
            market_filter = {
                "eventTypeIds": [EVENT_TYPE_GREYHOUNDS],
                "marketTypeCodes": ["WIN"],
                "marketStartTime": {
                    "from": utc_text(now - timedelta(minutes=5)),
                    "to": utc_text(now + timedelta(minutes=minutes)),
                },
            }
            params = {
                "filter": market_filter,
                "marketProjection": [
                    "EVENT",
                    "MARKET_START_TIME",
                    "RUNNER_DESCRIPTION",
                    "MARKET_DESCRIPTION",
                ],
                "sort": "FIRST_TO_START",
                "maxResults": "200",
                "locale": "en",
            }
            markets = []
            errors = []
            for exchange in ("au", "global"):
                try:
                    result = self._rpc(exchange, "listMarketCatalogue", params)
                    for market in result:
                        market["exchange"] = exchange
                        markets.append(market)
                except ConnectorError as error:
                    errors.append(f"{exchange}: {error}")
            if not markets and errors:
                raise ConnectorError("; ".join(errors))

        unique = {market["marketId"]: market for market in markets}
        ordered = sorted(unique.values(), key=lambda item: item.get("marketStartTime", ""))
        with self.lock:
            self.catalogue = {market["marketId"]: market for market in ordered}
        return {"markets": ordered, "fetchedAt": utc_text(), "delayed": True}

    def market_book(self, market_id: str, exchange: str) -> dict[str, Any]:
        self._require_connection()
        if not market_id:
            raise ConnectorError("marketId is required.", 400)
        if exchange not in BETTING_ENDPOINTS:
            raise ConnectorError("Unknown exchange.", 400)
        if self.demo:
            books = self._demo_book(market_id)
        else:
            params = {
                "marketIds": [market_id],
                "priceProjection": {
                    "priceData": ["EX_BEST_OFFERS", "EX_TRADED"],
                    "virtualise": True,
                },
            }
            books = self._rpc(exchange, "listMarketBook", params)
        if not books:
            raise ConnectorError("Betfair returned no market data.", 404)
        with self.lock:
            catalogue = self.catalogue.get(market_id)
        return {
            "book": books[0],
            "catalogue": catalogue,
            "fetchedAt": utc_text(),
            "delayed": True,
        }

    def _rpc(self, exchange: str, operation: str, params: dict[str, Any]) -> Any:
        payload = {
            "jsonrpc": "2.0",
            "method": f"SportsAPING/v1.0/{operation}",
            "params": params,
            "id": 1,
        }
        request = urllib.request.Request(
            BETTING_ENDPOINTS[exchange],
            data=json.dumps(payload).encode("utf-8"),
            headers=self._headers(),
            method="POST",
        )
        response = self._open_json(request)
        if response.get("error"):
            api_error = response["error"]
            details = api_error.get("data", {}).get("APINGException", {}).get("errorCode")
            raise ConnectorError(details or api_error.get("message") or "Betfair API error")
        return response.get("result", [])

    def _headers(self) -> dict[str, str]:
        return {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Application": self.app_key,
            "X-Authentication": self.token,
            "User-Agent": "TrackGuide/1.0",
        }

    def _open_json(self, request: urllib.request.Request) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            try:
                payload = json.loads(error.read().decode("utf-8"))
                message = payload.get("error") or payload.get("message") or str(error)
            except (ValueError, UnicodeDecodeError):
                message = str(error)
            raise ConnectorError(f"Betfair request failed: {message}", error.code) from error
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            raise ConnectorError(f"Could not reach Betfair: {error}") from error

    def _require_connection(self) -> None:
        if not self.connected:
            raise ConnectorError("Betfair is not connected.", 401)

    def _demo_markets(self) -> list[dict[str, Any]]:
        start = datetime.now(timezone.utc) + timedelta(minutes=3)
        runners = [
            {"selectionId": 1000 + index, "runnerName": name, "sortPriority": index}
            for index, name in enumerate(
                ["Rapid Echo", "Blue Lantern", "Final Turn", "Northbound", "City Limit", "Fast Detail"],
                start=1,
            )
        ]
        return [{
            "marketId": "demo.1",
            "marketName": "R5 450m Grade 5",
            "marketStartTime": utc_text(start),
            "event": {
                "name": "Ballarat Greyhounds",
                "countryCode": "AU",
                "timezone": "Australia/Sydney",
                "venue": "Ballarat",
            },
            "runners": runners,
            "exchange": "au",
        }]

    def _demo_book(self, market_id: str) -> list[dict[str, Any]]:
        if market_id != "demo.1":
            return []
        prices = [2.8, 4.2, 6.0, 8.2, 9.6, 13.0]
        runners = []
        for index, price in enumerate(prices, start=1):
            runners.append({
                "selectionId": 1000 + index,
                "status": "ACTIVE",
                "lastPriceTraded": price,
                "totalMatched": round(420 / index, 2),
                "ex": {
                    "availableToBack": [{"price": price, "size": round(80 / index, 2)}],
                    "availableToLay": [{"price": round(price + 0.1, 2), "size": round(70 / index, 2)}],
                },
            })
        return [{
            "marketId": market_id,
            "status": "OPEN",
            "inplay": False,
            "totalMatched": 1260.5,
            "runners": runners,
        }]


SESSION: BetfairSession


class ConnectorHandler(SimpleHTTPRequestHandler):
    server_version = "TrackGuideConnector/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format_string: str, *args: Any) -> None:
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/"):
            super().log_message(format_string, *args)

    def end_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        if not self._origin_allowed():
            self.send_error(403)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            super().do_GET()
            return
        if not self._origin_allowed():
            self._send_json({"error": "Origin not allowed."}, 403)
            return
        try:
            if parsed.path == "/api/betfair/status":
                self._send_json(SESSION.status())
            elif parsed.path == "/api/betfair/markets":
                query = urllib.parse.parse_qs(parsed.query)
                minutes = max(5, min(int(query.get("minutes", ["60"])[0]), 180))
                self._send_json(SESSION.markets(minutes))
            elif parsed.path == "/api/betfair/market":
                query = urllib.parse.parse_qs(parsed.query)
                market_id = query.get("marketId", [""])[0]
                exchange = query.get("exchange", ["global"])[0]
                self._send_json(SESSION.market_book(market_id, exchange))
            else:
                self._send_json({"error": "Not found."}, 404)
        except (ConnectorError, ValueError) as error:
            status = error.status if isinstance(error, ConnectorError) else 400
            self._send_json({"error": str(error)}, status)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self.send_error(405)
            return
        if not self._origin_allowed():
            self._send_json({"error": "Origin not allowed."}, 403)
            return
        try:
            if parsed.path == "/api/betfair/login":
                payload = self._read_json()
                SESSION.login(
                    str(payload.get("appKey", "")).strip(),
                    str(payload.get("username", "")).strip(),
                    str(payload.get("password", "")),
                    str(payload.get("jurisdiction", "au")),
                )
                self._send_json(SESSION.status())
            elif parsed.path == "/api/betfair/logout":
                SESSION.logout()
                self._send_json(SESSION.status())
            else:
                self._send_json({"error": "Not found."}, 404)
        except (ConnectorError, ValueError) as error:
            status = error.status if isinstance(error, ConnectorError) else 400
            self._send_json({"error": str(error)}, status)

    def _origin_allowed(self) -> bool:
        origin = self.headers.get("Origin")
        return origin is None or origin in ALLOWED_ORIGINS

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > 16_384:
            raise ValueError("Invalid request size.")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the local Track Guide Betfair connector.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--demo", action="store_true", help="Use local simulated markets.")
    parser.add_argument("--no-browser", action="store_true")
    return parser.parse_args()


def main() -> None:
    global SESSION
    args = parse_args()
    SESSION = BetfairSession(demo=args.demo)
    server = ThreadingHTTPServer((HOST, args.port), ConnectorHandler)
    url = f"http://{HOST}:{args.port}/"
    mode = "demo" if args.demo else "Betfair"
    print(f"Track Guide {mode} connector: {url}")
    print("Close this window to stop the connector.")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        SESSION.logout()
        server.server_close()


if __name__ == "__main__":
    main()
