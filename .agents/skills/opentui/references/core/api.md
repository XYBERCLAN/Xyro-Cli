# Core API Reference

## Renderer

### createCliRenderer(config?)

Creates and initializes the CLI renderer.

```typescript
import { createCliRenderer, type CliRendererConfig } from "@opentui/core"

const renderer = await createCliRenderer({
  targetFps: 30,              // Continuous rendering target (default: 30)
  maxFps: 60,                 // Cap immediate re-renders (default: 60)
  exitOnCtrlC: true,          // Exit process on Ctrl+C
  consoleOptions: {           // Debug console overlay
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
    startInDebugMode: false,
  },
  onDestroy: () => {},        // Cleanup callback
})
```

#### Custom stdin/stdout (SSH, PTY, xterm.js)

`CliRendererConfig` accepts custom streams so the renderer can drive a transport
other than the local terminal. When `stdout` is not `process.stdout`, native
frame bytes are routed through an internal `NativeSpanFeed`.

```typescript
const renderer = await createCliRenderer({
  stdin,                      // NodeJS.ReadStream (default: process.stdin)
  stdout,                     // NodeJS.WriteStream (default: process.stdout)
  width: cols,                // Fallback columns for non-TTY / custom stdout
  height: rows,               // Fallback rows for non-TTY / custom stdout
  remote: true,               // Treat output as a remote terminal (auto-detects SSH/mosh for process.stdout)
  forwardEnvKeys: [],         // Local env names forwarded to remote capability detection
  exitOnCtrlC: false,
})

// SIGWINCH is only auto-registered for process.stdout — call resize() manually
// when an external terminal reports a new size:
renderer.resize(newCols, newRows)

// Each stdin/stdout object may be owned by one renderer at a time. destroy()
// releases ownership and restores stdout.write. Allow a microtask to flush
// feed-backed bytes before closing the transport:
renderer.destroy()
await new Promise<void>((resolve) => queueMicrotask(resolve))
```

Size resolution order: `stdout.columns/rows` → `config.width/height` → `80x24`.
Env overrides: `OTUI_OVERRIDE_STDOUT` (force stdout routing),
`OTUI_USE_ALTERNATE_SCREEN`.

A feed-backed custom `stdout` defaults to `remote: true` and forwards no local
environment values. Pass only terminal-related names that genuinely describe
the remote terminal in `forwardEnvKeys`.

### CliRenderer Instance

```typescript
renderer.root              // Root renderable node
renderer.width             // Terminal width in columns
renderer.height            // Terminal height in rows
renderer.keyInput          // Keyboard event emitter
renderer.console           // Console overlay controller

renderer.start()           // Start render loop
renderer.stop()            // Stop render loop
renderer.destroy()         // Cleanup and exit alternate screen
renderer.requestRender()   // Request a re-render

renderer.setCursorStyle(options)  // Set cursor style
renderer.setCursorColor(color)    // Set cursor color
renderer.setMousePointer(style)   // Set mouse pointer shape
```

### Cursor & Mouse Pointer

```typescript
import { type CursorStyleOptions, type MousePointerStyle } from "@opentui/core"

// Set cursor style (options object)
renderer.setCursorStyle({
  style: "block",           // "block" | "line" | "underline" | "default"
  blinking: true,           // Cursor blink
  color: RGBA.fromHex("#FF0000"),  // Cursor color
  cursor: "pointer",        // Mouse pointer shape
})

// Set mouse pointer shape (OSC 22)
renderer.setMousePointer("pointer")
// Available: "default" | "pointer" | "text" | "crosshair" | "move" | "not-allowed"
```

### Renderer Events

```typescript
renderer.on("resize", (width, height) => {})     // Terminal resized
renderer.on("focus", () => {})                    // Terminal window gained focus
renderer.on("blur", () => {})                     // Terminal window lost focus
renderer.on("theme_mode", (mode) => {})           // "dark" | "light"
renderer.on("capabilities", (caps) => {})         // Terminal capabilities detected
renderer.on("selection", (selection) => {})       // Text selection finished (mouse-up)
renderer.on("destroy", () => {})                  // Renderer destroyed
renderer.on("memory:snapshot", (snapshot) => {})  // Memory snapshot
renderer.on("debugOverlay:toggle", () => {})      // Debug overlay toggled
renderer.on("frame", ({ frameId }) => {})         // A frame was committed
renderer.on("focused_renderable", (current, previous) => {})  // Focus moved
renderer.on("render:error", ({ error, renderable }) => {})     // Render pass threw
renderer.on("handler:error", ({ error, event }) => {})         // Mouse handler threw
```

If neither error event has a listener, OpenTUI logs the error. During a render
error, `renderable` identifies the node that was executing when available.
Mouse events expose both their original `target` and bubbling `currentTarget`.

### Scheduler & Idle

```typescript
await renderer.idle()             // Resolves when no render pass/scheduled render is pending
renderer.getSchedulerState()      // { isRunning, isRendering, hasScheduledRender }
renderer.resize(width, height)    // Apply an external terminal resize
```

### Desktop Notifications (OSC)

Send a terminal notification via OSC 9 / 777 / 99. Returns `true` only when a
supported protocol was detected.

```typescript
if (renderer.capabilities?.notifications) {
  renderer.triggerNotification("Tests passed", "CI")  // (message, title?)
}
```

tmux requires `set -g allow-passthrough on`; Zellij uses OSC 99. Env overrides:
`OPENTUI_NOTIFICATION_PROTOCOL` (`osc9`/`osc777`/`osc99`/`none`),
`OPENTUI_NOTIFICATIONS=0`.

### Audio

Native playback, streaming, capture, and recording exported from
`@opentui/core`.

#### Loaded Sounds

```typescript
import { Audio } from "@opentui/core"

const audio = Audio.create({ autoStart: false })  // or setupAudio(options?)
audio.on("error", (error, context) => console.error(`${context.action}: ${error.message}`))

const sound = await audio.loadSoundFile("click.wav")
if (sound != null && audio.start()) {
  audio.play(sound, { volume: 0.8, pan: 0, loop: false })
}

// Keep the engine alive while playback is active. Stop/dispose it during
// application cleanup, not immediately after play().
// audio.stop()
// audio.dispose()
```

Key methods: `start()`, `stop()`, `loadSound(data)`, `loadSoundFile(path)`,
`play(sound, options?)`, `stopVoice(voice)`, `group(name)`, `setGroupVolume()`,
`setMasterVolume()`, `listPlaybackDevices()`, `getStats()`, `dispose()`.
`AudioPlayOptions`: `{ volume?, pan?, loop?, groupId? }` (32 voice slots).

#### Streaming MP3 or FLAC

Start playback before creating a stream. Setup errors reject the entry method;
later errors are `AudioStream` events, so attach an error listener immediately.

```typescript
import { Audio, type AudioStream } from "@opentui/core"

const audio = Audio.create({ autoStart: false })
const abortController = new AbortController()
audio.on("error", (error, context) => console.error(context.action, error))
if (!audio.start()) throw new Error("No playback device")

const stream: AudioStream = await audio.playStreamUrl("https://example.com/radio.mp3", {
  format: "mp3",                    // "mp3" | "flac"
  buffer: { capacityMs: 2000, startupMs: 1000, resumeMs: 1000 },
  reconnect: { maxRetries: 5 },
  signal: abortController.signal,
})
stream.on("error", (error, context) => console.error(context.action, error))
stream.on("metadata", (metadata) => console.log(metadata)) // ICY metadata for URL streams
await stream.closed
```

Choose the source API by ownership:

| Method | Source policy |
|--------|---------------|
| `playStream(source, options?)` | One `ReadableStream<Uint8Array>` or `AsyncIterable<Uint8Array>` to EOF |
| `playStreamUrl(url, options?)` | Fetch, content-type validation, ICY metadata, optional reconnect |
| `playStreamSource(connector, options?)` | Custom connection and per-connection demuxer |

`AudioStream` exposes `state`, `closed`, `getStats()`, `getMetadata()`,
`setVolume()`, `setPan()`, `setGroup()`, and `dispose()`. Use
`createIcyStreamDemuxer()` for ICY framing on custom transports. Streaming does
not support WAV, AAC, Ogg, Opus, HLS, seeking, or pause.

#### Input Capture and WAV Recording

Capture is independent of playback. One `Audio` engine permits one capture
owner at a time.

```typescript
const capture = await audio.openCapture({ channels: 1, chunkFrames: 2048 })
capture.on("error", (error, context) => console.error(context.action, error))
const consumption = (async () => {
  for await (const pcm of capture.readable) {
    processFloat32Pcm(pcm, capture.channels)
  }
})()
await new Promise((resolve) => setTimeout(resolve, 1000))
capture.stop()                     // Gracefully drains unread PCM
await consumption
await capture.closed

const recorder = await audio.recordToFile("recording.wav", { channels: 1 })
recorder.on("error", (error, context) => console.error(context.action, error))
await new Promise((resolve) => setTimeout(resolve, 1000))
recorder.stop()                    // Finalizes and publishes PCM16 WAV
await recorder.closed
```

`openCapture()` returns an `AudioCaptureStream` with `readable`, `state`,
`getStats()`, `stop()`, `dispose()`, and `closed`. `recordToFile()` returns an
`AudioRecorder` with the same lifecycle plus `filePath` and `format: "wav"`.
For polling, use `startCapture()`, `readCaptureFrames()`, `getCaptureStats()`,
and `stopCapture()`. Device APIs are `listCaptureDevices()`,
`selectCaptureDevice()`, and `clearCaptureDeviceSelection()`. Microphone
permissions and device availability are platform-dependent.

### Console Overlay

```typescript
renderer.console.show()    // Show console overlay
renderer.console.hide()    // Hide console overlay
renderer.console.toggle()  // Toggle visibility/focus
renderer.console.clear()   // Clear console contents
```

## Renderables

All renderables extend the base `Renderable` class and share common properties.

### Common Properties

```typescript
interface CommonProps {
  id?: string                    // Identifier; duplicate IDs are allowed
  
  // Positioning
  position?: "relative" | "absolute"
  left?: number | string
  top?: number | string
  right?: number | string
  bottom?: number | string
  
  // Dimensions
  width?: number | string | "auto"
  height?: number | string | "auto"
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  
  // Flexbox
  flexDirection?: "row" | "column" | "row-reverse" | "column-reverse"
  flexGrow?: number
  flexShrink?: number
  flexBasis?: number | string
  flexWrap?: "nowrap" | "wrap" | "wrap-reverse"
  justifyContent?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"
  alignItems?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  alignSelf?: "auto" | "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  alignContent?: "flex-start" | "flex-end" | "center" | "stretch" | "space-between" | "space-around"
  
  // Spacing
  padding?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  margin?: number
  marginTop?: number
  marginRight?: number
  marginBottom?: number
  marginLeft?: number
  gap?: number
  
  // Display
  visible?: boolean
  overflow?: "visible" | "hidden" | "scroll"
  zIndex?: number
}
```

### Renderable Methods

```typescript
renderable.add(child)              // Add child renderable
renderable.remove(child)           // Remove child renderable
renderable.getRenderable(id)       // Find child by ID
renderable.focus()                 // Focus this renderable
renderable.blur()                  // Remove focus
renderable.destroy()               // Destroy and cleanup

renderable.on(event, handler)      // Add event listener
renderable.off(event, handler)     // Remove event listener
renderable.emit(event, ...args)    // Emit event
```

### TextRenderable

Display styled text content.

```typescript
import { TextRenderable, TextAttributes, t, bold, fg, underline } from "@opentui/core"

const text = new TextRenderable(renderer, {
  id: "text",
  content: "Hello World",
  fg: "#FFFFFF",                   // Foreground color
  bg: "#000000",                   // Background color
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
  selectable: true,                // Allow text selection
})

// Styled text with template literals
const styled = new TextRenderable(renderer, {
  content: t`${bold("Bold")} and ${fg("#FF0000")(underline("red underlined"))}`,
})
```

**TextAttributes flags:**
- `TextAttributes.BOLD`
- `TextAttributes.DIM`
- `TextAttributes.ITALIC`
- `TextAttributes.UNDERLINE`
- `TextAttributes.BLINK`
- `TextAttributes.INVERSE`
- `TextAttributes.HIDDEN`
- `TextAttributes.STRIKETHROUGH`

`createTextAttributes({ bold, italic, underline, dim, blink, inverse, reverse,
hidden, strikethrough })` builds the bit mask. `reverse` is an alias for
`inverse`.

### Box, Input, Select, Tab Select, ScrollBox, ASCII Font

Every component is `new <Name>Renderable(renderer, options)`, composed with
`.add()`. **Full option props for each live in the shared
[components](../components/REFERENCE.md) references** (e.g. Box titles →
[containers.md](../components/containers.md); `minLength` /
`showSelectionIndicator` → [inputs.md](../components/inputs.md)). This section
covers only the **Core-specific** surface: imperative composition and event
enums.

```typescript
import { BoxRenderable, TextRenderable } from "@opentui/core"

const box = new BoxRenderable(renderer, { id: "box", border: true, title: "Panel" })
box.add(new TextRenderable(renderer, { content: "Hello" }))  // Compose imperatively
box.focus()                                                   // Focusable boxes only
```

**Events (Core uses enums; React/Solid use `onChange`/`onSelect` props):**

```typescript
import {
  InputRenderableEvents,
  SelectRenderableEvents,
  TabSelectRenderableEvents,
} from "@opentui/core"

input.on(InputRenderableEvents.CHANGE, (value: string) => {})

// ITEM_SELECTED = Enter (confirm selection); SELECTION_CHANGED = arrow keys (browse)
select.on(SelectRenderableEvents.ITEM_SELECTED, (index, option) => {})
select.on(SelectRenderableEvents.SELECTION_CHANGED, (index, option) => {})
tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index, option) => {})
```

The `ITEM_SELECTED` / `SELECTION_CHANGED` distinction is identical for Select and
Tab Select. Inputs must be focused to receive keys (`input.focus()`).

### FrameBufferRenderable

Low-level 2D rendering surface.

```typescript
import { FrameBufferRenderable, RGBA } from "@opentui/core"

const canvas = new FrameBufferRenderable(renderer, {
  id: "canvas",
  width: 50,
  height: 20,
})

// Direct pixel manipulation
canvas.frameBuffer.fillRect(10, 5, 20, 8, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.drawText("Custom", 12, 7, RGBA.fromHex("#FFFFFF"))
canvas.frameBuffer.setCell(x, y, char, fg, bg)
canvas.frameBuffer.drawImage(nativeImage, x, y, width, height)
```

See [Image Component](../components/text-display.md#image-component) for
`NativeImage` ownership and terminal graphics protocols.

## Constructs (VNode API)

Declarative wrappers that create VNodes instead of direct instances.

```typescript
import { Text, Box, Input, Select, instantiate, delegate } from "@opentui/core"

// Create VNode tree
const ui = Box(
  { border: true, padding: 1 },
  Text({ content: "Hello" }),
  Input({ placeholder: "Type here..." }),
)

// Instantiate onto renderer
renderer.root.add(ui)

// Delegate focus to nested element
const form = delegate(
  { focus: "email-input" },
  Box(
    {},
    Text({ content: "Email:" }),
    Input({ id: "email-input", placeholder: "you@example.com" }),
  ),
)
form.focus()  // Focuses the input, not the box
```

## Colors (RGBA)

The `RGBA` class is exported from `@opentui/core` but works across **all frameworks** (Core, React, Solid). Use it for programmatic color manipulation.

### Creating Colors

```typescript
import { RGBA, parseColor } from "@opentui/core"

// From hex string (most common)
RGBA.fromHex("#FF0000")           // Full hex
RGBA.fromHex("#F00")              // Short hex

// From integers (0-255 range)
RGBA.fromInts(255, 0, 0, 255)     // r, g, b, a - fully opaque red
RGBA.fromInts(255, 0, 0, 128)     // 50% transparent red
RGBA.fromInts(0, 0, 0, 0)         // Fully transparent

// From normalized floats (0.0-1.0 range)
RGBA.fromValues(1.0, 0.0, 0.0, 1.0)   // Fully opaque red
RGBA.fromValues(0.1, 0.1, 0.1, 0.7)   // Dark gray, 70% opaque
RGBA.fromValues(0.0, 0.5, 1.0, 1.0)   // Light blue
```

### Common Color Patterns

```typescript
// Theme colors
const primary = RGBA.fromHex("#7aa2f7")      // Tokyo Night blue
const background = RGBA.fromHex("#1a1a2e")
const foreground = RGBA.fromHex("#c0caf5")
const error = RGBA.fromHex("#f7768e")

// Overlays and shadows
const modalOverlay = RGBA.fromValues(0.0, 0.0, 0.0, 0.5)  // 50% black
const shadow = RGBA.fromInts(0, 0, 0, 77)                  // 30% black

// Borders
const activeBorder = RGBA.fromHex("#7aa2f7")
const inactiveBorder = RGBA.fromInts(65, 72, 104, 255)
```

### parseColor Utility

```typescript
// Accepts multiple formats
parseColor("#FF0000")             // Hex string
parseColor("red")                 // CSS color name
parseColor("transparent")         // Special values
parseColor(RGBA.fromHex("#F00"))  // Pass-through RGBA objects
```

### When to Use Each Method

| Method | Use When |
|--------|----------|
| `fromHex()` | Working with design specs, CSS colors, config files |
| `fromInts()` | You have 8-bit values (0-255), common in graphics |
| `fromValues()` | Doing color interpolation, animations, math |
| `parseColor()` | Accepting user input or config that could be any format |

### Using RGBA in React/Solid

```tsx
// Import from @opentui/core, use in any framework
import { RGBA } from "@opentui/core"

// React or Solid component
function ThemedBox() {
  const bg = RGBA.fromHex("#1a1a2e")
  const border = RGBA.fromInts(122, 162, 247, 255)
  
  return (
    <box backgroundColor={bg} borderColor={border} border>
      <text fg={RGBA.fromHex("#c0caf5")}>Works everywhere!</text>
    </box>
  )
}
```

Color props in React/Solid accept both string formats (`"#FF0000"`, `"red"`) and `RGBA` objects.

## Keyboard Input

```typescript
import { type KeyEvent } from "@opentui/core"

renderer.keyInput.on("keypress", (key: KeyEvent) => {
  console.log(key.name)           // "a", "escape", "f1", etc.
  console.log(key.sequence)       // Raw escape sequence
  console.log(key.ctrl)           // Ctrl held
  console.log(key.shift)          // Shift held
  console.log(key.meta)           // Alt held
  console.log(key.option)         // Option held (macOS)
  console.log(key.eventType)      // "press" | "release" | "repeat"
})

renderer.keyInput.on("paste", (event: PasteEvent) => {
  const text = decodePasteBytes(event.bytes)
  console.log("Pasted:", text)
})
```

## Animation Timeline

```typescript
import { Timeline, engine } from "@opentui/core"

const timeline = new Timeline({
  duration: 2000,
  loop: false,
  autoplay: true,
})

timeline.add(
  { width: 0 },
  {
    width: 50,
    duration: 1000,
    ease: "outQuad",
    onUpdate: (anim) => {
      box.width = anim.targets[0].width
    },
  },
)

engine.attach(renderer)
engine.register(timeline)
```

## Type Exports

```typescript
import type {
  CliRenderer,
  CliRendererConfig,
  RenderContext,
  KeyEvent,
  Renderable,
  WidthMethod,          // "wcwidth" | "unicode" | "unicode-wide"
  SelectionOccupancy,  // "cell" | "boundary"
  SelectionBehavior,   // "cell" | "word" | "line"
  // ... and more
} from "@opentui/core"
```
