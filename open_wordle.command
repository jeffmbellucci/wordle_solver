#!/bin/bash
# Launch the Wordle solver (index.html) in the left half of the screen and the
# NYT Wordle puzzle in the right half, each in its own browser window.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOLVER_URL="file://$SCRIPT_DIR/index.html"
PUZZLE_URL="https://www.nytimes.com/games/wordle/index.html"

osascript <<EOF
set solverUrl to "$SOLVER_URL"
set puzzleUrl to "$PUZZLE_URL"

-- Usable screen bounds (excludes menu bar and Dock).
set screenW to 1440
set screenH to 900
try
    tell application "Finder"
        set b to bounds of window of desktop
        set screenW to item 3 of b
        set screenH to item 4 of b
    end tell
end try

set leftW to screenW div 2
set rightW to screenW - leftW
set leftBounds to {0, 0, leftW, screenH}
set rightBounds to {leftW, 0, screenW, screenH}

set chromeInstalled to false
try
    do shell script "test -d \"/Applications/Google Chrome.app\" -o -d \"$HOME/Applications/Google Chrome.app\""
    set chromeInstalled to true
end try

if chromeInstalled then
    tell application "Google Chrome"
        activate
        make new window
        set URL of active tab of front window to solverUrl
        set bounds of front window to leftBounds
        make new window
        set URL of active tab of front window to puzzleUrl
        set bounds of front window to rightBounds
    end tell
else
    tell application "Safari"
        activate
        make new document with properties {URL:solverUrl}
        set bounds of front window to leftBounds
        make new document with properties {URL:puzzleUrl}
        set bounds of front window to rightBounds
    end tell
end if
EOF