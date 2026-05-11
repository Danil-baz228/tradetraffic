@echo off
setlocal
cd /d "%~dp0"

if exist "runtime-live-current.out.log" del /q "runtime-live-current.out.log"
if exist "runtime-live-current.err.log" del /q "runtime-live-current.err.log"

".venv\Scripts\python.exe" -m uvicorn app.web:app --host 127.0.0.1 --port 8000 --log-level info 1>"runtime-live-current.out.log" 2>"runtime-live-current.err.log"
