@echo off
REM Sistema Shawarma Desktop App Launcher
REM This script runs the built desktop application

setlocal enabledelayedexpansion

REM Check if app is built
if not exist "dist-app\win-unpacked\Sistema Shawarma.exe" (
    echo.
    echo ❌ Application not found!
    echo.
    echo Please build the app first:
    echo   npm run build:electron
    echo.
    pause
    exit /b 1
)

REM Launch the app
echo.
echo 🚀 Starting Sistema Shawarma Desktop Application...
echo.

start "" "dist-app\win-unpacked\Sistema Shawarma.exe"

exit /b 0
