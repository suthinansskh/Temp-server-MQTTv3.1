@echo off
title Upload to ESP8266 via USB (COM Port)

echo ====================================================
echo Uploading Firmware via USB...
echo ====================================================
echo.

"%USERPROFILE%\.platformio\penv\Scripts\pio.exe" run -t upload -e esp12e

echo.
pause
