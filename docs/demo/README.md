# README demo footage

The GIF and screenshots in the main README are recorded from the real XYRO interface with [vhs](https://github.com/charmbracelet/vhs). Only the model is replaced: [`fake-model.mjs`](fake-model.mjs) is a small OpenAI-compatible server that plays back a scripted conversation, so every recording is identical, needs no API key and sends no code anywhere. The tools, approvals, edits and test run you see are XYRO's own.

```bash
npm run demo   # build, then redraw the banner, the GIF and the screenshots into docs/assets/
```

| File | What it does |
|---|---|
| [`fake-model.mjs`](fake-model.mjs) | The scripted model (port 4545) |
| [`setup.sh`](setup.sh) | A throwaway `shop-api` project and an isolated XYRO config, so your own settings and keys are never touched |
| [`style.tape`](style.tape) | Shared terminal size, font, colours and off-camera setup |
| [`demo.tape`](demo.tape) · [`screenshots.tape`](screenshots.tape) | The hero GIF and the feature screenshots |
| [`banner.mjs`](banner.mjs) | Draws the README header from the TUI's own logo art |

Recording needs `vhs` (which brings `ttyd` and `ffmpeg`) and the JetBrainsMono Nerd Font.
