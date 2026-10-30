# Shared look for every README recording (sourced by the other tapes).
Set Shell "bash"
Set FontFamily "JetBrainsMono Nerd Font Mono"
Set FontSize 15
Set LineHeight 1.15
Set Width 1440
Set Height 860
Set Padding 26
Set Margin 36
Set MarginFill "docs/demo/backdrop.png"
Set BorderRadius 14
Set WindowBar Colorful
Set WindowBarSize 38
Set Framerate 24
Set TypingSpeed 42ms
Set Theme { "name": "XYRO", "background": "#0B1018", "foreground": "#E6EDF3", "cursor": "#38BDF8", "selection": "#1F2A3A", "black": "#111823", "red": "#F47174", "green": "#22C55E", "yellow": "#F59E0B", "blue": "#3B82F6", "magenta": "#C084FC", "cyan": "#38BDF8", "white": "#E6EDF3", "brightBlack": "#8592AD", "brightRed": "#F47174", "brightGreen": "#22C55E", "brightYellow": "#F59E0B", "brightBlue": "#60A5FA", "brightMagenta": "#C084FC", "brightCyan": "#4FC3E0", "brightWhite": "#FFFFFF" }

# Start the scripted model and a throwaway project, off camera
Hide
Type 'export XYRO_ROOT="$PWD"' Enter
Type "node docs/demo/fake-model.mjs >/dev/null 2>&1 &" Enter
Type 'source docs/demo/setup.sh >/dev/null && cd "$DEMO_DIR"' Enter
Type 'xyro() { node "$XYRO_ROOT/dist/index.js" "$@"; }' Enter
Type "export PS1='\[\e[38;2;56;189;248m\]shop-api\[\e[0m\] \[\e[38;2;133;146;173m\]❯\[\e[0m\] '" Enter
Type "clear" Enter
Sleep 1s
Show
