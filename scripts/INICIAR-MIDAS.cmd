@echo off
setlocal
title Configurar MIDAS - Neon y Vercel
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js. Instala la version LTS desde https://nodejs.org
  echo Despues cierra esta ventana y abre INICIAR-MIDAS.cmd nuevamente.
  pause
  exit /b 1
)
node.exe "%~dp0configurar-midas.cjs"
set "MIDAS_RESULT=%ERRORLEVEL%"
echo.
if not "%MIDAS_RESULT%"=="0" echo No se completo la configuracion. Revisa el mensaje anterior.
pause
exit /b %MIDAS_RESULT%
