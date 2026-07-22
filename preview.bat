@echo off
rem Starts the local preview server for Episode Roulette and opens it in the browser.
rem Phone preview (same WiFi): http://THIS-PC-IP:8010  (run `ipconfig` for the IP)
cd /d "%~dp0"
start "" http://localhost:8010
python -m http.server 8010
