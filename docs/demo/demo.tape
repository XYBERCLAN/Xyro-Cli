# The README hero: one real XYRO turn, from prompt to passing tests.
# Re-record with: npm run build && vhs docs/demo/demo.tape
Output docs/assets/demo.gif
Source docs/demo/style.tape

# Open on XYRO's home screen: the first frame is what npm and link previews show
Hide
Type "xyro"
Enter
Wait+Screen@20s /send/
Sleep 1s
Show
Sleep 2s

Type "Add input validation to the signup handler, then run the tests"
Sleep 700ms
Enter

# XYRO asks before it changes a file or runs a command
Wait+Screen@20s /Allow this action/
Sleep 1.6s
Type "y"
Sleep 1.5s
Wait+Screen@20s /Allow this action/
Sleep 1.4s
Type "y"
Wait+Screen@25s /All 4 tests pass/
Sleep 3.5s

Hide
Ctrl+C
Sleep 300ms
Ctrl+C
Type "kill %1" Enter
