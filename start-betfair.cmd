@echo off
setlocal
cd /d "%~dp0"

py -3 --version >nul 2>nul
if not errorlevel 1 (
  py -3 betfair_connector.py
  goto :end
)

python --version >nul 2>nul
if not errorlevel 1 (
  python betfair_connector.py
  goto :end
)

echo Python 3 is required to run the Betfair connector.
echo Install it from https://www.python.org/downloads/windows/
pause

:end
endlocal
