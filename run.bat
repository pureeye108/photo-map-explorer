@echo off
title PhotoMap Explorer
echo ========================================================
echo        PhotoMap Explorer (GPS & Landmark Mapper)
echo ========================================================
echo.
echo Starting Flask web server on http://127.0.0.1:5000 ...
start "" http://127.0.0.1:5000
python app.py
pause
