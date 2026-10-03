@echo off
rem dsh-winui-skin uninstaller — runs uninstall.ps1 with the policy bypassed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
exit /b %errorlevel%
