@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS or newer from https://nodejs.org then reopen this launcher.
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 24 or newer is required. Update from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\@modelcontextprotocol\sdk\package.json" (
  call npm ci --omit=dev --ignore-scripts
  if errorlevel 1 (
    echo Dependency installation failed. Check your connection and run npm ci in this folder.
    pause
    exit /b 1
  )
)
node "src\launcher.mjs"
if errorlevel 1 pause
