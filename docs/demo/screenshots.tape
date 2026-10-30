# Still screenshots for the README feature sections.
# Re-record with: npm run build && vhs docs/demo/screenshots.tape
Output docs/demo/.screenshots.gif
Source docs/demo/style.tape

Type "xyro"
Enter
Wait+Screen@20s /send/
Sleep 1.5s

# Command palette
Type "/"
Sleep 1.2s
Screenshot docs/assets/commands.png
Escape
Sleep 600ms

# The expert team
Type "/experts"
Sleep 300ms
Enter
Sleep 1.8s
Screenshot docs/assets/experts.png
Escape
Sleep 600ms

# XYRO asks before it changes a file
Type "Add input validation to the signup handler, then run the tests"
Enter
Wait+Screen@20s /Allow this action/
Sleep 1.2s
Screenshot docs/assets/approval.png
Type "y"
Sleep 1.5s
Wait+Screen@20s /Allow this action/
Sleep 1s
Type "y"
Wait+Screen@25s /All 4 tests pass/
Sleep 1s

Hide
Ctrl+C
Sleep 300ms
Ctrl+C
Type "kill %1" Enter
