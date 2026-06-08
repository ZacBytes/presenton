# Script to start both backend and frontend correctly
$AppData = "C:\Users\zacha\AppData\Local\presenton"
$env:APP_DATA_DIRECTORY = $AppData
$env:USER_CONFIG_PATH = "$AppData\userConfig.json"

Write-Host "Starting FastAPI backend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd servers/fastapi; `$env:APP_DATA_DIRECTORY='$AppData'; `$env:USER_CONFIG_PATH='$AppData\userConfig.json'; .\.venv\Scripts\python server.py --port 8000"

Write-Host "Starting Next.js frontend..."
cd servers/nextjs
npx.cmd next dev
