#!/usr/bin/env zsh

$terminal = ghostty
$browser = flatpak run app.zen_browser.zen
$discord = discord
$chrome = google-chrome
$goxlr = goxlr-daemon
$slack = slack
$postmanagent = ~/Applications/Postman Agent/Postman Agent

$goxlr &
$postmanagent &

# Add a delay for monitors to be set up
sleep 8

$slack &
$terminal &
$browser &
$chrome --profile-directory="Profile 1" &

