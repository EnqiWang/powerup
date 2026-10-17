@echo off
cd /d "%~dp0"
echo PoweruP full workflow - open http://localhost:8004
echo Keep this window open. Press Ctrl+C to stop.
py -3 server.py --port 8004 --open
pause
