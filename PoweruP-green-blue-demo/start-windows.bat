@echo off
rem PoweruP local demo server. Serves this folder on http://localhost:8004 (static files only).
cd /d "%~dp0"
set URL=http://localhost:8004/?demo=1
where py >nul 2>nul && (set PY=py -3) || (set PY=python)
echo Opening %URL%   (Ctrl+C to stop)
start "" "%URL%"
%PY% -m http.server 8004 --bind 127.0.0.1
