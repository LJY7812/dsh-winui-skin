@echo off
rem dsh-winui-skin installer — runs install.ps1 with the execution policy bypassed,
rem which is required because the script is not digitally signed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %errorlevel%
