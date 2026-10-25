@echo off
title Trainu
cd /d "%~dp0"
node "bin\trainu.mjs" %*
if errorlevel 1 (
  echo.
  echo Trainu stopped with an error.
  pause
)
