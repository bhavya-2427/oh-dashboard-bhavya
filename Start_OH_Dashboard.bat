@echo off
cd /d "%~dp0"

echo Checking Backend...

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8001/docs' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1"

if errorlevel 1 (
    echo Starting Backend...
    start "OH Dashboard Backend" cmd /k "cd backend && python -m uvicorn app.main:app --port 8001"
) else (
    echo Backend is already running.
)

timeout /t 4 /nobreak >nul

echo Checking Frontend...

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1"

if errorlevel 1 (
    echo Starting Frontend...
    start "OH Dashboard Frontend" cmd /k "cd frontend && npm run dev"
) else (
    echo Frontend is already running.
)

echo Waiting for frontend to become ready...

:CHECK_FRONTEND
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:5173' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1"

if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto CHECK_FRONTEND
)

start http://localhost:5173

echo.
echo OH Dashboard started successfully.
