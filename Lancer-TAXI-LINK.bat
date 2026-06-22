@echo off
chcp 65001 >nul
title TAXI-LINK
cd /d "%~dp0"
echo ============================================================
echo   TAXI-LINK - serveur local
echo ============================================================
echo.
echo   Sur CE PC          :  http://localhost:5180
echo.
echo   Sur ton TELEPHONE  :  http://192.168.1.44:5180
echo   (PC et telephone sur le MEME Wi-Fi)
echo.
echo   1er lancement : Windows demande d'AUTORISER Python
echo                   sur les reseaux prives  -^>  clique Autoriser
echo.
echo   Pour arreter le serveur : ferme cette fenetre.
echo ============================================================
echo.
start "" http://localhost:5180
py -m http.server 5180 --bind 0.0.0.0
pause
