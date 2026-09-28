@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo === Source, unit tests, production build and browser verification ===
node tests\verify.mjs
if errorlevel 1 goto failed
echo PASSED. See tests\artifacts\verification.html
pause
exit /b 0
:failed
echo FAILED. See tests\artifacts\final-verification.json
pause
exit /b 1
