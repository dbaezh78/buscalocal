@echo off
:: Cambiar a codificación UTF-8 para que se vean bien los bordes
chcp 65001 > nul
cls
title Buscador de Contenido Local - dbaezh
color 0B

echo ╔══════════════════════════════════════════════════════╗
echo ║             BUSCADOR DE CONTENIDO LOCAL              ║
echo ╠══════════════════════════════════════════════════════╣
echo ║                                                      ║
echo ║                Hecho por: dbaezh                     ║
echo ║                                                      ║
echo ╚══════════════════════════════════════════════════════╝
echo.

set /p "choice=¿Quieres correr el script? (S/N): "

if /i "%choice%" NEQ "S" (
    echo.
    echo Operación cancelada. Saliendo...
    timeout /t 2 > nul
    exit
)

echo.
echo [INFO] Iniciando el proceso...
echo.

:: Capturar la hora de inicio
set "startTime=%time%"

:: 1. Abrir Chrome primero
echo [INFO] Abriendo interfaz en Google Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5000/
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" http://localhost:5000/
) else (
    start http://localhost:5000/
)

:: 2. Ejecutar el buscador
echo [INFO] Iniciando servidor Node...
node C:\db\Github\buscalocal\buscador.js

:: Capturar la hora de finalización (al cerrar Node)
set "endTime=%time%"

echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║               PROCESO FINALIZADO                     ║
echo ╠══════════════════════════════════════════════════════╣
echo   Hora de inicio: %startTime%
echo   Hora de fin:    %endTime%
echo.
echo   Autor: dbaezh
echo ╚══════════════════════════════════════════════════════╝
echo.
pause