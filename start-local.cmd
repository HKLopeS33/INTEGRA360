@echo off
setlocal

cd /d "%~dp0"

start "Sistema Shawarma - API Local" cmd /k npm.cmd run dev:api
start "Sistema Shawarma - Painel" cmd /k npm.cmd run dev:desktop

echo Servidores iniciando...
echo API: http://localhost:3333
echo Painel: http://127.0.0.1:5173
echo.
echo Se o navegador nao abrir automaticamente, acesse o Painel manualmente.
pause
