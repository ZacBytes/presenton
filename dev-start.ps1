# Presenton local dev startup script
# Run this once to start both servers: .\dev-start.ps1

$AppData = "C:\Users\zacha\AppData\Local\presenton"

# Kill any leftover processes on our ports
$port8000 = (netstat -ano | Select-String ":8000 " | Select-String "LISTENING" | ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($port8000) { taskkill /PID $port8000 /F | Out-Null }
$port3000 = (netstat -ano | Select-String ":3000 " | Select-String "LISTENING" | ForEach-Object { ($_ -split "\s+")[-1] } | Select-Object -First 1)
if ($port3000) { taskkill /PID $port3000 /F | Out-Null }

# Start FastAPI backend
Write-Host "Starting FastAPI backend on http://127.0.0.1:8000 ..." -ForegroundColor Cyan
$fastapi = Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "`$env:APP_DATA_DIRECTORY='$AppData'; `$env:USER_CONFIG_PATH='$AppData\userConfig.json'; cd '$PSScriptRoot\servers\fastapi'; .\.venv\Scripts\python server.py --port 8000"
) -PassThru
Write-Host "FastAPI PID: $($fastapi.Id)"

# Wait for FastAPI to be ready
Write-Host "Waiting for FastAPI..." -ForegroundColor Yellow
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/auth/status" -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if (-not $ready) { Write-Host "WARNING: FastAPI may not be ready yet" -ForegroundColor Red }
else { Write-Host "FastAPI is ready!" -ForegroundColor Green }

# Start Next.js frontend
Write-Host "Starting Next.js frontend on http://localhost:3000 ..." -ForegroundColor Cyan
$nextjs = Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$PSScriptRoot\servers\nextjs'; npx.cmd next dev"
) -PassThru
Write-Host "Next.js PID: $($nextjs.Id)"

Write-Host ""
Write-Host "Both servers started. Open http://localhost:3000 in your browser." -ForegroundColor Green
Write-Host "Press Ctrl+C in each terminal window to stop."
