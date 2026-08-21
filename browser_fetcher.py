"""Small local Chromium renderer used when a form source serves only a shell or 403."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


class BrowserUnavailable(RuntimeError):
    """Raised when no installed browser can render a requested source page."""


class ChromiumBrowserFetcher:
    WINDOWS_CANDIDATES = (
        ("PROGRAMFILES(X86)", "Microsoft/Edge/Application/msedge.exe"),
        ("PROGRAMFILES", "Microsoft/Edge/Application/msedge.exe"),
        ("PROGRAMFILES", "Google/Chrome/Application/chrome.exe"),
        ("PROGRAMFILES(X86)", "Google/Chrome/Application/chrome.exe"),
        ("LOCALAPPDATA", "Microsoft/Edge/Application/msedge.exe"),
        ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
    )

    def __init__(self, executable: str | None = None, wait_milliseconds: int = 10_000) -> None:
        self.executable = executable
        self.wait_milliseconds = wait_milliseconds

    def fetch(self, url: str) -> str:
        executables = [self.executable] if self.executable else self._find_executables()
        if not executables:
            raise BrowserUnavailable("No local Edge or Chrome browser was found.")
        failures = []
        for executable in executables:
            try:
                return self._render(executable, url)
            except BrowserUnavailable as error:
                failures.append(str(error))
        raise BrowserUnavailable("Every installed browser failed. " + " ".join(failures))

    def _render(self, executable: str, url: str) -> str:
        with tempfile.TemporaryDirectory(prefix="track-guide-form-") as profile:
            command = [
                executable,
                "--headless=new",
                "--disable-blink-features=AutomationControlled",
                f"--user-agent={USER_AGENT}",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-component-update",
                "--no-first-run",
                "--no-default-browser-check",
                "--window-size=1280,1800",
                f"--virtual-time-budget={self.wait_milliseconds}",
                f"--user-data-dir={profile}",
                "--dump-dom",
                url,
            ]
            try:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    timeout=max(30, self.wait_milliseconds // 1000 + 25),
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                    check=False,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                raise BrowserUnavailable(f"{Path(executable).stem} failed: {error}") from error
        rendered = completed.stdout.decode("utf-8", errors="replace")
        if completed.returncode != 0 or len(rendered) < 1_000:
            raise BrowserUnavailable(f"{Path(executable).stem} did not return a rendered page.")
        return rendered

    @classmethod
    def _find_executables(cls) -> list[str]:
        candidates = []
        override = os.environ.get("TRACK_GUIDE_BROWSER")
        if override and Path(override).is_file():
            candidates.append(override)
        for name in ("msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser"):
            found = shutil.which(name)
            if found and found not in candidates:
                candidates.append(found)
        for environment, suffix in cls.WINDOWS_CANDIDATES:
            root = os.environ.get(environment)
            if root:
                candidate = Path(root) / Path(suffix)
                value = str(candidate)
                if candidate.is_file() and value not in candidates:
                    candidates.append(value)
        return candidates
