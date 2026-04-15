@echo off
cls
title Buscador de Contenido Local - dbaezh
color 0B

echo =======================================================
echo           BUSCADOR DE CONTENIDO LOCAL
echo =======================================================
echo.
echo           Hecho por: dbaezh
echo.
echo =======================================================
echo.

set /p "choice=¿Quieres correr el script? (S/N): "

if /i "%choice%" NEQ "S" (
    echo.
    echo Operacion cancelada. Saliendo...
    timeout /t 2 > nul
    exit
)

echo.
echo [INFO] Iniciando el proceso...
echo.

:: Capturar la hora de inicio
set "startTime=%time%"

:: 1. Intentar abrir Chrome PRIMERO
echo [INFO] Abriendo interfaz en Google Chrome...
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" http://localhost:5000/
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" http://localhost:5000/
) else (
    start http://localhost:5000/
)

:: 2. Ejecutar el buscador (Node)
echo [INFO] Iniciando servidor Node...
node C:\db\Github\buscalocal\buscador.js

:: Nota: Si el buscador.js es un servidor persistente, el script se quedara aqui.
:: Capturar la hora de finalizacion (se registrara al cerrar el proceso de Node)
set "endTime=%time%"

echo.
echo =======================================================
echo            PROCESO FINALIZADO
echo =======================================================
echo.
echo  Hora de inicio: %startTime%
echo  Hora de fin:    %endTime%
echo.
echo  Autor: dbaezh
echo =======================================================
echo.
pause