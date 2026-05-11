@echo off
setlocal
cd /d "%~dp0"

if exist "localtunnel-active.out.log" del /q "localtunnel-active.out.log"
if exist "localtunnel-active.err.log" del /q "localtunnel-active.err.log"

call npx localtunnel --port 8000 1>"localtunnel-active.out.log" 2>"localtunnel-active.err.log"
