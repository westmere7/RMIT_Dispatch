@echo off
rem ============================================================
rem RMIT Dispatch - quick local test server
rem Installs deps on first run, then starts Vite on port 5174
rem (falls back to the next free port if 5174 is taken).
rem
rem Realtime two-user testing: open BOTH
rem   http://localhost:5174  and  http://127.0.0.1:5174
rem (separate localStorage = two signed-in users side by side)
rem ============================================================
cd /d "%~dp0"

if not exist node_modules (
  echo [server.bat] node_modules missing - running npm install...
  call npm install
  if errorlevel 1 (
    echo [server.bat] npm install failed.
    pause
    exit /b 1
  )
)

if not exist .env.local (
  echo [server.bat] WARNING: .env.local not found - the app will show the
  echo               "not configured" screen. See README.md for setup.
)

echo [server.bat] Starting dev server on http://localhost:5174 ...
rem --host binds all interfaces so 127.0.0.1 works too (two-user testing).
call npm run dev -- --port 5174 --host --open
pause
